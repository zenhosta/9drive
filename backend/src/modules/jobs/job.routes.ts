import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { createAuditLog } from '../../utils/audit.js'
import { serializeItem, serializeJob } from './job.service.js'
import { kickMoveRunner, refreshJob } from './move-runner.js'

export const jobRouter = Router()
jobRouter.use(requireAuth)

jobRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), active: z.enum(['1']).optional() }).parse(req.query)
    const jobs = await prisma.moveJob.findMany({
      where: { userId: req.user!.id, ...(query.active ? { status: { in: ['queued', 'running'] } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    })
    return res.json({ jobs: jobs.map(serializeJob) })
  } catch (error) {
    return next(error)
  }
})

jobRouter.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query)
    const job = await prisma.moveJob.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id } })
    const items = await prisma.moveJobItem.findMany({ where: { jobId: job.id, ...(query.status ? { status: query.status } : {}) }, orderBy: { updatedAt: 'desc' }, take: query.limit })
    const accountIds = [...new Set(items.flatMap((i) => [i.sourceAccountId, i.targetAccountId]))]
    const accounts = await prisma.connectedAccount.findMany({ where: { id: { in: accountIds }, userId: req.user!.id }, select: { id: true, email: true } })
    return res.json({ job: serializeJob(job), items: items.map(serializeItem), accounts })
  } catch (error) {
    return next(error)
  }
})

jobRouter.post('/:id/cancel', async (req: AuthRequest, res, next) => {
  try {
    const job = await prisma.moveJob.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id } })
    if (job.finishedAt) return res.status(409).json({ code: 'JOB_FINISHED', message: 'Job already finished.' })
    await prisma.moveJob.update({ where: { id: job.id }, data: { cancelRequested: true } })
    // Queued items stop immediately; a running item stops at its next checkpoint and removes any unverified copy.
    await prisma.moveJobItem.updateMany({ where: { jobId: job.id, status: 'queued' }, data: { status: 'cancelled' } })
    await refreshJob(job.id)
    await createAuditLog(req.user!.id, 'MOVE_JOB_CANCELLED', 'move_job', job.id)
    return res.json({ job: serializeJob(await prisma.moveJob.findUniqueOrThrow({ where: { id: job.id } })) })
  } catch (error) {
    return next(error)
  }
})

jobRouter.post('/:id/retry', async (req: AuthRequest, res, next) => {
  try {
    const job = await prisma.moveJob.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id } })
    if (job.cancelRequested) return res.status(409).json({ code: 'JOB_CANCELLED', message: 'Cancelled jobs cannot be retried. Start a new move.' })
    if (!job.finishedAt) return res.status(409).json({ code: 'JOB_RUNNING', message: 'Job is still running.' })
    // Items that failed after the DB switch resume at their saved step; everything else restarts from the beginning.
    const result = await prisma.moveJobItem.updateMany({ where: { jobId: job.id, status: 'failed' }, data: { status: 'queued', error: null, attempts: 0 } })
    if (result.count === 0) return res.status(409).json({ code: 'NOTHING_TO_RETRY', message: 'No failed items.' })
    await prisma.moveJob.update({ where: { id: job.id }, data: { finishedAt: null, status: 'queued' } })
    kickMoveRunner()
    return res.json({ retried: result.count })
  } catch (error) {
    return next(error)
  }
})
