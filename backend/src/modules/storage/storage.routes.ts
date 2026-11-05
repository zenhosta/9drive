import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { syncGoogleQuota } from '../google/google.service.js'
import { syncS3Quota } from '../s3/s3.service.js'
import { createAuditLog } from '../../utils/audit.js'
import { createMoveJob, JobRequestError } from '../jobs/job.service.js'
import { isNativeGoogleMime } from '../jobs/move-logic.js'
import { buildPlan, type PlanAccount } from './rebalance-plan.js'

export const storageRouter = Router()
storageRouter.use(requireAuth)

type BreakdownRow = { kind: string; bytes: bigint | number | string | null }

function bytesToString(value: bigint | number | string | null | undefined) {
  if (value === null || value === undefined) return '0'
  return value.toString()
}

const routingModes = ['most_available', 'round_robin', 'priority'] as const
const routingPolicySchema = z.object({ mode: z.enum(routingModes), priorityAccountIds: z.array(z.string().min(1)).max(100).optional() })

function normalizePriorityAccountIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function getOrCreateRoutingPolicy(userId: string) {
  return prisma.uploadRoutingPolicy.upsert({
    where: { userId },
    create: { userId, mode: 'most_available', priorityAccountIds: [] },
    update: {},
  })
}

storageRouter.get('/summary', async (req: AuthRequest, res, next) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({ where: { userId: req.user!.id, status: 'connected' }, include: { storageAccount: true } })
    const summary = accounts.reduce((acc, account) => {
      const storage = account.storageAccount
      acc.totalBytes += storage?.totalBytes ?? 0n
      acc.usedBytes += storage?.usedBytes ?? 0n
      acc.availableBytes += storage?.availableBytes ?? 0n
      return acc
    }, { totalBytes: 0n, usedBytes: 0n, availableBytes: 0n })

    return res.json({
      totalBytes: summary.totalBytes.toString(),
      usedBytes: summary.usedBytes.toString(),
      availableBytes: summary.availableBytes.toString(),
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.email,
        status: account.status,
        totalBytes: account.storageAccount?.totalBytes?.toString() ?? null,
        usedBytes: account.storageAccount?.usedBytes.toString() ?? '0',
        availableBytes: account.storageAccount?.availableBytes?.toString() ?? null,
        lastSyncedAt: account.storageAccount?.lastSyncedAt ?? null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

storageRouter.get('/routing-policy', async (req: AuthRequest, res, next) => {
  try {
    const policy = await getOrCreateRoutingPolicy(req.user!.id)
    return res.json({ policy: { id: policy.id, mode: policy.mode, priorityAccountIds: normalizePriorityAccountIds(policy.priorityAccountIds), roundRobinCursor: policy.roundRobinCursor } })
  } catch (error) {
    return next(error)
  }
})

storageRouter.patch('/routing-policy', async (req: AuthRequest, res, next) => {
  try {
    const body = routingPolicySchema.parse(req.body)
    const accountIds = [...new Set(body.priorityAccountIds ?? [])]
    const validAccounts = accountIds.length === 0 ? [] : await prisma.connectedAccount.findMany({ where: { id: { in: accountIds }, userId: req.user!.id, status: 'connected' }, select: { id: true } })
    const validIds = new Set(validAccounts.map((account) => account.id))
    const priorityAccountIds = accountIds.filter((id) => validIds.has(id))
    const policy = await prisma.uploadRoutingPolicy.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, mode: body.mode, priorityAccountIds, roundRobinCursor: 0 },
      update: { mode: body.mode, priorityAccountIds, ...(body.mode !== 'round_robin' ? { roundRobinCursor: 0 } : {}) },
    })
    return res.json({ policy: { id: policy.id, mode: policy.mode, priorityAccountIds: normalizePriorityAccountIds(policy.priorityAccountIds), roundRobinCursor: policy.roundRobinCursor } })
  } catch (error) {
    return next(error)
  }
})

storageRouter.get('/breakdown', async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRaw<BreakdownRow[]>`
      SELECT
        CASE
          WHEN mime_type LIKE 'image/%' THEN 'photo'
          WHEN mime_type LIKE 'video/%' THEN 'video'
          ELSE 'document'
        END AS kind,
        COALESCE(SUM(size_bytes), 0) AS bytes
      FROM files
      WHERE user_id = ${req.user!.id} AND status = 'active'
      GROUP BY kind
    `
    const breakdown = { photo: '0', video: '0', document: '0' }
    for (const row of rows) {
      if (row.kind === 'photo' || row.kind === 'video' || row.kind === 'document') breakdown[row.kind] = bytesToString(row.bytes)
    }
    return res.json(breakdown)
  } catch (error) {
    return next(error)
  }
})

type AccountHealth = 'ok' | 'needs_reconnect' | 'error'

// lastError is free text written by quota-sync and upload failures; map the auth-related ones to a reconnect prompt.
function deriveHealth(account: { provider: string; lastError: string | null; accessTokenEncrypted: string | null; refreshTokenEncrypted: string | null }): AccountHealth {
  if (account.provider === 'google_drive' && (!account.accessTokenEncrypted || !account.refreshTokenEncrypted)) return 'needs_reconnect'
  if (!account.lastError) return 'ok'
  return /invalid_grant|tokens? (are )?missing|unauthorized|invalid_client|revoked|expired|401/i.test(account.lastError) ? 'needs_reconnect' : 'error'
}

async function loadOverview(userId: string) {
  const [accounts, fileStats] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId, status: 'connected' }, include: { storageAccount: true }, orderBy: { createdAt: 'asc' } }),
    prisma.file.groupBy({ by: ['connectedAccountId'], where: { userId, status: 'active' }, _count: { _all: true }, _sum: { sizeBytes: true } }),
  ])
  const statsByAccount = new Map(fileStats.map((row) => [row.connectedAccountId, { count: row._count._all, bytes: row._sum.sizeBytes ?? 0n }]))

  let totalBytes = 0n
  let usedBytes = 0n
  let availableBytes = 0n
  let totalFiles = 0
  let totalFileBytes = 0n
  let unlimitedAccounts = 0

  const rows = accounts.map((account) => {
    const storage = account.storageAccount
    const stats = statsByAccount.get(account.id) ?? { count: 0, bytes: 0n }
    const unlimited = !storage || storage.totalBytes === null
    if (unlimited) unlimitedAccounts += 1
    else {
      totalBytes += storage.totalBytes ?? 0n
      availableBytes += storage.availableBytes ?? 0n
    }
    usedBytes += storage?.usedBytes ?? 0n
    totalFiles += stats.count
    totalFileBytes += stats.bytes
    return {
      id: account.id,
      provider: account.provider,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      totalBytes: storage?.totalBytes?.toString() ?? null,
      usedBytes: storage?.usedBytes.toString() ?? '0',
      availableBytes: storage?.availableBytes?.toString() ?? null,
      trashBytes: storage?.trashBytes?.toString() ?? null,
      unlimited,
      lastSyncedAt: storage?.lastSyncedAt ?? null,
      fileCount: stats.count,
      fileBytes: stats.bytes.toString(),
      health: deriveHealth(account),
      lastError: account.lastError,
    }
  })

  return {
    totals: {
      accountCount: accounts.length,
      unlimitedAccounts,
      // Capacity/free cover accounts with a known limit only; used covers every account.
      totalBytes: totalBytes.toString(),
      usedBytes: usedBytes.toString(),
      availableBytes: availableBytes.toString(),
      fileCount: totalFiles,
      fileBytes: totalFileBytes.toString(),
    },
    accounts: rows,
  }
}

storageRouter.get('/overview', async (req: AuthRequest, res, next) => {
  try {
    return res.json(await loadOverview(req.user!.id))
  } catch (error) {
    return next(error)
  }
})

storageRouter.post('/overview/refresh', async (req: AuthRequest, res, next) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({ where: { userId: req.user!.id, status: 'connected' }, select: { id: true, email: true, provider: true } })
    const results = await Promise.all(accounts.map(async (account) => {
      try {
        if (account.provider === 's3') await syncS3Quota(account.id)
        else await syncGoogleQuota(account.id)
        await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastError: null } })
        return { accountId: account.id, ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Quota sync failed'
        await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastError: message.slice(0, 1000) } }).catch(() => undefined)
        return { accountId: account.id, ok: false as const, message }
      }
    }))
    return res.json({ results, overview: await loadOverview(req.user!.id) })
  } catch (error) {
    return next(error)
  }
})

const bytesString = z.string().regex(/^\d+$/)
const planSchema = z.object({
  sourceAccountId: z.string().min(1),
  targetAccountIds: z.array(z.string().min(1)).max(50).optional(),
  freeUpBytes: bytesString.optional(),
  targetUsedPercent: z.number().min(1).max(99).optional(),
})

function toPlanAccount(a: { id: string; email: string; storageAccount: { totalBytes: bigint | null; usedBytes: bigint; availableBytes: bigint | null } | null }): PlanAccount {
  return { id: a.id, email: a.email, totalBytes: a.storageAccount?.totalBytes ?? null, usedBytes: a.storageAccount?.usedBytes ?? 0n, availableBytes: a.storageAccount?.availableBytes ?? null }
}

storageRouter.post('/rebalance/plan', async (req: AuthRequest, res, next) => {
  try {
    const body = planSchema.parse(req.body)
    if ((body.freeUpBytes === undefined) === (body.targetUsedPercent === undefined)) return res.status(400).json({ code: 'PLAN_INVALID', message: 'Provide exactly one of freeUpBytes or targetUsedPercent.' })
    const userId = req.user!.id
    const source = await prisma.connectedAccount.findFirst({ where: { id: body.sourceAccountId, userId, provider: 'google_drive', status: 'connected' } })
    if (!source) return res.status(404).json({ code: 'SOURCE_NOT_FOUND', message: 'Source must be a connected Google Drive account.' })
    const targetRows = await prisma.connectedAccount.findMany({ where: { userId, provider: 'google_drive', status: 'connected', id: { not: source.id, ...(body.targetAccountIds ? { in: body.targetAccountIds } : {}) } } })
    if (targetRows.length === 0) return res.status(400).json({ code: 'NO_TARGETS', message: 'No other connected Google Drive accounts to move files to.' })

    const quotaFailures: string[] = []
    await Promise.all([source, ...targetRows].map((a) => syncGoogleQuota(a.id).catch(() => quotaFailures.push(a.email))))
    const [freshSource, freshTargets] = await Promise.all([
      prisma.connectedAccount.findUniqueOrThrow({ where: { id: source.id }, include: { storageAccount: true } }),
      prisma.connectedAccount.findMany({ where: { id: { in: targetRows.map((t) => t.id) } }, include: { storageAccount: true } }),
    ])
    const planSource = toPlanAccount(freshSource)
    if (body.targetUsedPercent !== undefined && !planSource.totalBytes) return res.status(400).json({ code: 'PLAN_INVALID', message: 'This drive has no known capacity, so a target percentage cannot be used. Enter an amount to free instead.' })

    const files = await prisma.file.findMany({ where: { userId, connectedAccountId: source.id, provider: 'google_drive', status: 'active' }, select: { id: true, name: true, sizeBytes: true, mimeType: true } })
    const plan = buildPlan({
      source: planSource,
      targets: freshTargets.map(toPlanAccount),
      files: files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.sizeBytes, isNative: isNativeGoogleMime(f.mimeType) })),
      freeUpBytes: body.freeUpBytes !== undefined ? BigInt(body.freeUpBytes) : undefined,
      targetUsedPercent: body.targetUsedPercent,
    })
    if (quotaFailures.length > 0) plan.warnings.unshift(`Could not refresh quota for: ${quotaFailures.join(', ')}. Numbers for those drives may be out of date.`)
    // Drive usage includes things 9Drive doesn't track; the plan can only move files 9Drive knows about.
    const knownBytes = files.reduce((s, f) => s + f.sizeBytes, 0n)
    if (plan.needBytes > knownBytes) plan.warnings.push('You asked to free more than the files 9Drive tracks on this drive. Run "Sync Drive" in All Files if files were added outside 9Drive.')

    const emailById = new Map([freshSource, ...freshTargets].map((a) => [a.id, a.email]))
    return res.json({
      sourceAccountId: source.id,
      needBytes: plan.needBytes.toString(),
      plannedBytes: plan.plannedBytes.toString(),
      shortfallBytes: plan.shortfallBytes.toString(),
      nativeExcluded: plan.nativeExcluded,
      warnings: plan.warnings,
      items: plan.items.map((i) => ({ fileId: i.fileId, name: i.name, sizeBytes: i.sizeBytes.toString(), targetAccountId: i.targetAccountId, targetEmail: emailById.get(i.targetAccountId) })),
      unplaced: plan.unplaced.map((u) => ({ ...u, sizeBytes: u.sizeBytes.toString() })),
      accounts: plan.accounts.map((a) => ({
        id: a.id, email: a.email, role: a.id === source.id ? 'source' : 'target',
        totalBytes: a.totalBytes?.toString() ?? null, usedBefore: a.usedBefore.toString(), usedAfter: a.usedAfter.toString(),
        availableBefore: a.availableBefore?.toString() ?? null, availableAfter: a.availableAfter?.toString() ?? null,
        filesIn: a.filesIn, filesOut: a.filesOut,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

const executeSchema = z.object({
  sourceAccountId: z.string().min(1),
  items: z.array(z.object({ fileId: z.string().min(1), targetAccountId: z.string().min(1) })).min(1).max(5000),
})

// The plan is not trusted: every file, account and the free space is re-validated when the job is created.
storageRouter.post('/rebalance/execute', async (req: AuthRequest, res, next) => {
  try {
    const body = executeSchema.parse(req.body)
    const result = await createMoveJob(req.user!.id, 'rebalance', body.items, { includeNative: false, nativeFormat: 'native' }, body.sourceAccountId)
    await createAuditLog(req.user!.id, 'REBALANCE_STARTED', 'move_job', result.job.id, { sourceAccountId: body.sourceAccountId, count: result.accepted })
    return res.status(202).json({ jobId: result.job.id, accepted: result.accepted, skipped: result.skipped, warnings: result.warnings })
  } catch (error) {
    if (error instanceof JobRequestError) return res.status(error.status).json({ code: error.code, message: error.message, details: error.details })
    return next(error)
  }
})
