import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { CATEGORY_KEYS, CATEGORY_LABELS, categoryWhere, classifyFile, type CategoryKey } from '../files/file-types.js'
import { streamGoogleFile } from '../files/stream-google-file.js'
import { getAuthedGoogleClient } from '../google/google.service.js'
import { createFolder, listChildFolders, resolveFolder } from '../google/google-copy.js'
import { google } from 'googleapis'
import { isScanRunning, startScans } from './drive-scan.js'

export const driveIndexRouter = Router()
driveIndexRouter.use(requireAuth)

const MB = 1024 * 1024

const filterQuery = z.object({
  category: z.enum(['all', ...CATEGORY_KEYS]).default('all'),
  accountId: z.string().optional(),
  q: z.string().trim().max(255).optional(),
  minSizeMb: z.coerce.number().min(0).optional(),
  maxSizeMb: z.coerce.number().min(0).optional(),
})

type Filters = z.infer<typeof filterQuery>

// categoryWhere() only touches mimeType and name, which DriveItem shares with File.
const typeWhere = (key: CategoryKey) => categoryWhere(key) as Prisma.DriveItemWhereInput

function whereFor(userId: string, f: Filters, opts: { skipCategory?: boolean; skipAccount?: boolean } = {}): Prisma.DriveItemWhereInput {
  const and: Prisma.DriveItemWhereInput[] = [{ userId }]
  if (f.accountId && !opts.skipAccount) and.push({ connectedAccountId: f.accountId })
  if (f.q) and.push({ OR: [{ name: { contains: f.q } }, { path: { contains: f.q } }] })
  if (f.minSizeMb !== undefined) and.push({ sizeBytes: { gte: BigInt(Math.round(f.minSizeMb * MB)) } })
  if (f.maxSizeMb !== undefined) and.push({ sizeBytes: { lte: BigInt(Math.round(f.maxSizeMb * MB)) } })
  if (f.category !== 'all' && !opts.skipCategory) and.push(typeWhere(f.category as CategoryKey))
  return { AND: and }
}

const accountSelect = { id: true, email: true, displayName: true, provider: true } as const

function serialize(item: { sizeBytes: bigint; name: string; mimeType: string } & Record<string, unknown>) {
  return { ...item, sizeBytes: item.sizeBytes.toString(), category: classifyFile(item.mimeType, item.name) }
}

driveIndexRouter.post('/scan', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ accountIds: z.array(z.string().min(1)).max(50).optional() }).parse(req.body ?? {})
    const started = await startScans(req.user!.id, body.accountIds)
    return res.status(202).json({ started })
  } catch (error) {
    return next(error)
  }
})

driveIndexRouter.get('/scan', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id
    const accounts = await prisma.connectedAccount.findMany({ where: { userId, provider: 'google_drive', status: 'connected' }, include: { driveScan: true }, orderBy: { createdAt: 'asc' } })
    const counts = await prisma.driveItem.groupBy({ by: ['connectedAccountId'], where: { userId }, _count: { _all: true }, _sum: { sizeBytes: true } })
    const byAccount = new Map(counts.map((c) => [c.connectedAccountId, c]))
    return res.json({
      accounts: accounts.map((a) => ({
        accountId: a.id,
        email: a.email,
        displayName: a.displayName,
        status: isScanRunning(a.id) ? 'running' : (a.driveScan?.status ?? 'never'),
        itemsFound: a.driveScan?.itemsFound ?? 0,
        indexedCount: byAccount.get(a.id)?._count._all ?? 0,
        indexedBytes: (byAccount.get(a.id)?._sum.sizeBytes ?? 0n).toString(),
        error: a.driveScan?.error ?? null,
        startedAt: a.driveScan?.startedAt ?? null,
        finishedAt: a.driveScan?.finishedAt ?? null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

driveIndexRouter.get('/summary', async (req: AuthRequest, res, next) => {
  try {
    const f = filterQuery.parse(req.query)
    const userId = req.user!.id
    const base = whereFor(userId, f, { skipCategory: true })
    const [total, ...perCategory] = await Promise.all([
      prisma.driveItem.aggregate({ where: base, _count: { _all: true }, _sum: { sizeBytes: true } }),
      ...CATEGORY_KEYS.map((key) => prisma.driveItem.aggregate({ where: { AND: [base, typeWhere(key)] }, _count: { _all: true }, _sum: { sizeBytes: true } })),
    ])
    // Per-drive numbers ignore the drive filter so the drive picker always shows where files live.
    const perDrive = await prisma.driveItem.groupBy({ by: ['connectedAccountId'], where: whereFor(userId, f, { skipAccount: true }), _count: { _all: true }, _sum: { sizeBytes: true } })
    return res.json({
      total: { count: total._count._all, sizeBytes: (total._sum.sizeBytes ?? 0n).toString() },
      categories: CATEGORY_KEYS.map((key, i) => ({ key, label: CATEGORY_LABELS[key], count: perCategory[i]._count._all, sizeBytes: (perCategory[i]._sum.sizeBytes ?? 0n).toString() })),
      drives: perDrive.map((d) => ({ accountId: d.connectedAccountId, count: d._count._all, sizeBytes: (d._sum.sizeBytes ?? 0n).toString() })),
    })
  } catch (error) {
    return next(error)
  }
})

const listQuery = filterQuery.extend({
  sort: z.enum(['name', 'size', 'date', 'path']).default('size'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

driveIndexRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const where = whereFor(req.user!.id, q)
    const field = q.sort === 'name' ? 'name' : q.sort === 'size' ? 'sizeBytes' : q.sort === 'path' ? 'path' : 'modifiedAt'
    const [total, items] = await Promise.all([
      prisma.driveItem.count({ where }),
      prisma.driveItem.findMany({ where, include: { connectedAccount: { select: accountSelect } }, orderBy: [{ [field]: q.order }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return res.json({ page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), files: items.map(serialize) })
  } catch (error) {
    return next(error)
  }
})

// "Pick files totalling about N bytes", largest first, within the current filters.
driveIndexRouter.get('/select-by-size', async (req: AuthRequest, res, next) => {
  try {
    const q = filterQuery.extend({ bytes: z.string().regex(/^\d+$/) }).parse(req.query)
    const target = BigInt(q.bytes)
    const where: Prisma.DriveItemWhereInput = { AND: [whereFor(req.user!.id, q), { sizeBytes: { gt: 0n } }] }
    const items = await prisma.driveItem.findMany({ where, orderBy: [{ sizeBytes: 'desc' }, { id: 'asc' }], take: 3000, include: { connectedAccount: { select: accountSelect } } })
    const picked: typeof items = []
    let sum = 0n
    for (const item of items) {
      if (sum >= target) break
      picked.push(item)
      sum += item.sizeBytes
    }
    return res.json({ totalBytes: sum.toString(), count: picked.length, reachedTarget: sum >= target, files: picked.map(serialize) })
  } catch (error) {
    return next(error)
  }
})

// ---- Folder tree browsing (what the Drive looks like, merged across drives unless a drive is chosen) ----

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

driveIndexRouter.get('/browse', async (req: AuthRequest, res, next) => {
  try {
    const q = z.object({
      accountId: z.string().optional(),
      path: z.string().max(1000).default('My Drive'),
      sort: z.enum(['name', 'size', 'date']).default('name'),
      order: z.enum(['asc', 'desc']).default('asc'),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query)
    const userId = req.user!.id
    const path = q.path.replace(/\/+$/, '') || 'My Drive'
    const account = q.accountId ? Prisma.sql`AND connected_account_id = ${q.accountId}` : Prisma.empty
    const prefix = `${likeEscape(path)}/%`
    const start = path.length + 2

    const folderRows = await prisma.$queryRaw<Array<{ seg: string; c: bigint | number; s: bigint | number | null }>>`
      SELECT SUBSTRING_INDEX(SUBSTRING(path, ${start}), '/', 1) AS seg, COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS s
      FROM drive_items
      WHERE user_id = ${userId} ${account} AND path LIKE ${prefix}
      GROUP BY seg ORDER BY seg`
    const where: Prisma.DriveItemWhereInput = { userId, path, ...(q.accountId ? { connectedAccountId: q.accountId } : {}) }
    const field = q.sort === 'size' ? 'sizeBytes' : q.sort === 'date' ? 'modifiedAt' : 'name'
    const [total, items] = await Promise.all([
      prisma.driveItem.count({ where }),
      prisma.driveItem.findMany({ where, include: { connectedAccount: { select: accountSelect } }, orderBy: [{ [field]: q.order }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return res.json({
      path,
      folders: folderRows.filter((r) => r.seg).map((r) => ({ name: r.seg, path: `${path}/${r.seg}`, count: Number(r.c), sizeBytes: String(r.s ?? 0) })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      files: items.map(serialize),
    })
  } catch (error) {
    return next(error)
  }
})

// ---- Destination folder picker (live view of the target Drive's folders) ----

const driveId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)

async function driveForAccount(userId: string, accountId: string) {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
  return google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
}

driveIndexRouter.get('/folders', async (req: AuthRequest, res, next) => {
  try {
    const q = z.object({ accountId: z.string().min(1), parentId: driveId.default('root') }).parse(req.query)
    const drive = await driveForAccount(req.user!.id, q.accountId)
    const folders = await listChildFolders(drive, q.parentId)
    return res.json({ parentId: q.parentId, folders })
  } catch (error) {
    return next(error)
  }
})

driveIndexRouter.post('/folders', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ accountId: z.string().min(1), parentId: driveId.default('root'), name: z.string().trim().min(1).max(255) }).parse(req.body)
    const drive = await driveForAccount(req.user!.id, body.accountId)
    const folder = await createFolder(drive, body.parentId, body.name)
    const resolved = await resolveFolder(drive, folder.id)
    return res.status(201).json({ folder: { id: folder.id, name: folder.name, path: resolved.path } })
  } catch (error) {
    return next(error)
  }
})

driveIndexRouter.get('/:id/download', async (req: AuthRequest, res, next) => {
  try {
    const item = await prisma.driveItem.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id }, include: { connectedAccount: true } })
    // streamGoogleFile only reads providerFileId, mimeType, name and connectedAccount.
    return streamGoogleFile(item as unknown as Parameters<typeof streamGoogleFile>[0] & { providerFileId: string }, req.headers.range, res, { disposition: 'attachment' })
  } catch (error) {
    return next(error)
  }
})
