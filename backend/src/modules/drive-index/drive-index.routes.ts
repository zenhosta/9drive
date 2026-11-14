import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { CATEGORY_KEYS, CATEGORY_LABELS, categoryWhere, classifyFile, type CategoryKey } from '../files/file-types.js'
import { streamGoogleFile } from '../files/stream-google-file.js'
import { getAuthedGoogleClient } from '../google/google.service.js'
import { createFolder, listChildFolders, resolveFolder } from '../google/google-copy.js'
import { withBackoff } from '../google/backoff.js'
import { ThumbCache, thumbCache } from './thumb-cache.js'
import { google } from 'googleapis'
import { createDeleteJob, expandFolders, JobRequestError } from '../jobs/job.service.js'
import { createAuditLog } from '../../utils/audit.js'
import { isScanRunning, retryOnLock, startScans } from './drive-scan.js'
import { cleanName, cleanPath, ensurePath, findChildFolder, isAppFolder, parentOf, PathError, rememberFolder, resolvePath, rewritePaths, ROOT_PATH } from './drive-folders.js'

export const driveIndexRouter = Router()
// Short-lived, file-bound links so <img>, <video> and <iframe> can load a file without sending the login header.
export const driveViewRouter = Router()
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
    // Folders with no files inside only exist in drive_folders.
    const emptyRows = await prisma.$queryRaw<Array<{ seg: string }>>`
      SELECT SUBSTRING_INDEX(SUBSTRING(path, ${start}), '/', 1) AS seg
      FROM drive_folders
      WHERE user_id = ${userId} ${account} AND path LIKE ${prefix}
      GROUP BY seg`
    const folderMap = new Map(folderRows.filter((r) => r.seg).map((r) => [r.seg.toLowerCase(), { name: r.seg, path: `${path}/${r.seg}`, count: Number(r.c), sizeBytes: String(r.s ?? 0) }]))
    for (const r of emptyRows) if (r.seg && !folderMap.has(r.seg.toLowerCase())) folderMap.set(r.seg.toLowerCase(), { name: r.seg, path: `${path}/${r.seg}`, count: 0, sizeBytes: '0' })
    const folderList = [...folderMap.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    const where: Prisma.DriveItemWhereInput = { userId, path, ...(q.accountId ? { connectedAccountId: q.accountId } : {}) }
    const field = q.sort === 'size' ? 'sizeBytes' : q.sort === 'date' ? 'modifiedAt' : 'name'
    const [total, items] = await Promise.all([
      prisma.driveItem.count({ where }),
      prisma.driveItem.findMany({ where, include: { connectedAccount: { select: accountSelect } }, orderBy: [{ [field]: q.order }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ])
    return res.json({
      path,
      folders: folderList,
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

// ---- Changing what is in a folder: new folder, rename file, rename folder ----

const RECONNECT_MESSAGE = 'Google sign-in for this drive has expired. Reconnect it in Settings.'

/** Google refused the stored login (revoked, password changed, or a 7-day token from an OAuth app in Testing mode). */
function isAuthError(error: unknown) {
  const e = error as { message?: string; response?: { data?: { error?: string } } }
  return /invalid_grant|invalid_rapt|Token has been expired or revoked/i.test(`${e?.message ?? ''} ${e?.response?.data?.error ?? ''}`)
}

/** Marks the drive so Overview shows "needs reconnect" (cleared by the next successful quota sync). */
async function flagReconnect(accountId: string) {
  await prisma.connectedAccount.update({ where: { id: accountId }, data: { lastError: 'invalid_grant: reconnect required' } }).catch(() => undefined)
}

function opError(res: import('express').Response, error: unknown, accountId?: string) {
  if (error instanceof PathError) return res.status(error.status).json({ code: error.code, message: error.message })
  // Not 401: that would make the app think the user's own 9Drive session ended.
  if (isAuthError(error)) {
    if (accountId) void flagReconnect(accountId)
    return res.status(409).json({ code: 'DRIVE_NEEDS_RECONNECT', message: RECONNECT_MESSAGE })
  }
  const status = (error as { code?: number; status?: number })?.code ?? (error as { status?: number })?.status
  if (status === 403 || status === 404) return res.status(status).json({ code: status === 403 ? 'DRIVE_FORBIDDEN' : 'DRIVE_NOT_FOUND', message: status === 403 ? 'Google Drive did not allow this change.' : 'Google Drive could not find that item. Try Rescan.' })
  return null
}

const scanBusy = (res: import('express').Response) => res.status(409).json({ code: 'SCAN_RUNNING', message: 'This drive is being scanned. Try again when the scan finishes.' })

driveIndexRouter.post('/browse/folder', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ accountId: z.string().min(1), path: z.string().max(1000).default(ROOT_PATH), name: z.string().max(300) }).parse(req.body)
    const userId = req.user!.id
    const parent = cleanPath(body.path)
    const name = cleanName(body.name)
    const path = `${parent}/${name}`
    if (path.length > 1000) throw new PathError('That folder path is too long.')
    const drive = await driveForAccount(userId, body.accountId)
    const parentId = await ensurePath(drive, userId, body.accountId, parent)
    if (await findChildFolder(drive, parentId, name)) return res.status(409).json({ code: 'FOLDER_EXISTS', message: `A folder named "${name}" is already here.` })
    const created = await withBackoff(() => drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }, fields: 'id,name' }))
    if (!created.data.id) throw new PathError('Google Drive did not create the folder.', 502, 'FOLDER_CREATE_FAILED')
    await rememberFolder(userId, body.accountId, created.data.id, path)
    await createAuditLog(userId, 'CREATE_DRIVE_FOLDER', 'drive_folder', created.data.id, { accountId: body.accountId, path })
    return res.status(201).json({ folder: { name, path, accountId: body.accountId } })
  } catch (error) {
    return opError(res, error, typeof req.body?.accountId === 'string' ? req.body.accountId : undefined) ?? next(error)
  }
})

driveIndexRouter.post('/:id/rename', async (req: AuthRequest, res, next) => {
  let itemAccount: string | undefined
  try {
    const { name: raw } = z.object({ name: z.string().max(300) }).parse(req.body)
    const name = cleanName(raw)
    const userId = req.user!.id
    const item = await prisma.driveItem.findFirstOrThrow({ where: { id: String(req.params.id), userId } })
    itemAccount = item.connectedAccountId
    if (isScanRunning(item.connectedAccountId)) return scanBusy(res)
    if (name === item.name) return res.json({ file: serialize(item) })
    const drive = await driveForAccount(userId, item.connectedAccountId)
    await withBackoff(() => drive.files.update({ fileId: item.providerFileId, requestBody: { name }, fields: 'id' }))
    const updated = await retryOnLock(() => prisma.driveItem.update({ where: { id: item.id }, data: { name, modifiedAt: new Date() } }))
    // Keep 9Drive's own record of the same Drive file in step (Uploads view, share links).
    await prisma.file.updateMany({ where: { userId, connectedAccountId: item.connectedAccountId, providerFileId: item.providerFileId }, data: { name } })
    await createAuditLog(userId, 'RENAME_DRIVE_FILE', 'drive_item', item.id, { from: item.name, to: name })
    return res.json({ file: serialize(updated) })
  } catch (error) {
    return opError(res, error, itemAccount) ?? next(error)
  }
})

driveIndexRouter.post('/browse/rename-folder', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ accountId: z.string().min(1).optional(), path: z.string().max(1000), name: z.string().max(300) }).parse(req.body)
    const userId = req.user!.id
    const from = cleanPath(body.path)
    const name = cleanName(body.name)
    if (from === ROOT_PATH) throw new PathError('My Drive itself cannot be renamed.')
    if (isAppFolder(from)) throw new PathError('The 9drive folder holds your 9Drive uploads, so it keeps its name.', 400, 'APP_FOLDER')
    const to = `${parentOf(from)}/${name}`
    if (to === from) return res.json({ path: to, renamed: [], failed: [] })
    if (to.length > 1000) throw new PathError('That folder path is too long.')

    // In the merged "All drives" view the folder is that path on every drive that has it.
    let accountIds: string[]
    if (body.accountId) accountIds = [body.accountId]
    else {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT connected_account_id AS id FROM drive_items WHERE user_id = ${userId} AND (path COLLATE utf8mb4_bin = ${from} OR path COLLATE utf8mb4_bin LIKE ${`${likeEscape(from)}/%`})
        UNION SELECT DISTINCT connected_account_id AS id FROM drive_folders WHERE user_id = ${userId} AND path COLLATE utf8mb4_bin = ${from}`
      accountIds = rows.map((r) => r.id)
    }
    if (accountIds.length === 0) return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'That folder was not found. Try Rescan.' })
    if (accountIds.some(isScanRunning)) return scanBusy(res)

    const renamed: string[] = []
    const failed: Array<{ accountId: string; message: string }> = []
    for (const accountId of accountIds) {
      try {
        const drive = await driveForAccount(userId, accountId)
        const folderId = await resolvePath(drive, userId, accountId, from)
        if (!folderId || folderId === 'root') throw new PathError('Folder not found on this drive. Try Rescan.', 404, 'FOLDER_NOT_FOUND')
        const parentId = await resolvePath(drive, userId, accountId, parentOf(from))
        const clash = parentId ? await findChildFolder(drive, parentId, name) : null
        if (clash && clash !== folderId) throw new PathError(`A folder named "${name}" is already next to it.`, 409, 'FOLDER_EXISTS')
        await withBackoff(() => drive.files.update({ fileId: folderId, requestBody: { name }, fields: 'id' }))
        await rewritePaths(accountId, from, to)
        await rememberFolder(userId, accountId, folderId, to)
        // A 9Drive virtual folder can be backed by this Drive folder; keep its name in step.
        await prisma.folder.updateMany({ where: { userId, providerFolderId: folderId }, data: { name } })
        renamed.push(accountId)
      } catch (error) {
        if (isAuthError(error)) void flagReconnect(accountId)
        const known = error instanceof PathError ? error.message : isAuthError(error) ? RECONNECT_MESSAGE : (error as { code?: number })?.code === 403 ? 'Google Drive did not allow this change.' : null
        if (!known) console.error('[rename-folder] failed', accountId, error instanceof Error ? error.message : error)
        failed.push({ accountId, message: known ?? 'Rename failed on this drive.' })
      }
    }
    await createAuditLog(userId, 'RENAME_DRIVE_FOLDER', 'drive_folder', undefined, { from, to, renamed: renamed.length, failed: failed.length })
    if (renamed.length === 0) {
      const conflict = failed.find((f) => f.message.includes('already'))
      return res.status(conflict ? 409 : 502).json({ code: conflict ? 'FOLDER_EXISTS' : 'RENAME_FAILED', message: failed[0]?.message ?? 'Rename failed.', failed })
    }
    return res.json({ path: to, renamed, failed })
  } catch (error) {
    return opError(res, error) ?? next(error)
  }
})

driveIndexRouter.post('/delete', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      driveItemIds: z.array(z.string().min(1)).max(10000).default([]),
      folders: z.array(z.object({ accountId: z.string().min(1), path: z.string().min(1).max(1000) })).max(200).default([]),
      permanent: z.boolean().default(false),
    }).parse(req.body)
    const expanded = body.folders.length ? await expandFolders(req.user!.id, body.folders, '') : []
    const ids = [...body.driveItemIds, ...expanded.flatMap((r) => (r.driveItemId ? [r.driveItemId] : []))]
    const result = await createDeleteJob(req.user!.id, ids, body.permanent)
    await createAuditLog(req.user!.id, body.permanent ? 'DELETE_DRIVE_FILES_PERMANENT' : 'TRASH_DRIVE_FILES', 'move_job', result.job.id, { count: result.count })
    return res.status(202).json({ jobId: result.job.id, count: result.count, skipped: result.skipped })
  } catch (error) {
    if (error instanceof JobRequestError) return res.status(error.status).json({ code: error.code, message: error.message, details: error.details })
    return next(error)
  }
})

// Small preview image for any file Drive can thumbnail (photos, videos, PDFs, documents...). Fetched server-side with
// the account's own credentials, so the browser never needs a Google login and the image is cached for an hour.
const thumbLinkCache = new Map<string, { link: string | null; at: number }>()

driveIndexRouter.get('/:id/thumb', async (req: AuthRequest, res, next) => {
  try {
    const item = await prisma.driveItem.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id }, include: { connectedAccount: true } })
    const cacheKey = ThumbCache.key(item.connectedAccountId, item.providerFileId)
    const cached = await thumbCache.get(cacheKey).catch(() => null)
    if (cached) {
      res.setHeader('Content-Type', cached.type)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      return res.send(cached.data)
    }
    const auth = await getAuthedGoogleClient(item.connectedAccount)
    let entry = thumbLinkCache.get(item.id)
    if (!entry || Date.now() - entry.at > 20 * 60_000) {
      const meta = await withBackoff(() => google.drive({ version: 'v3', auth }).files.get({ fileId: item.providerFileId, fields: 'thumbnailLink' }))
      entry = { link: meta.data.thumbnailLink ? meta.data.thumbnailLink.replace(/=s\d+$/, '=s400') : null, at: Date.now() }
      thumbLinkCache.set(item.id, entry)
      if (thumbLinkCache.size > 5000) thumbLinkCache.delete(thumbLinkCache.keys().next().value as string)
    }
    if (!entry.link) return res.status(404).json({ code: 'NO_THUMBNAIL', message: 'No thumbnail for this file.' })
    const headers = await auth.getRequestHeaders()
    const image = await fetch(entry.link, { headers: headers instanceof Headers ? Object.fromEntries(headers.entries()) : (headers as Record<string, string>) })
    if (!image.ok) { thumbLinkCache.delete(item.id); return res.status(404).json({ code: 'NO_THUMBNAIL', message: 'Thumbnail unavailable.' }) }
    const data = Buffer.from(await image.arrayBuffer())
    const type = image.headers.get('content-type') ?? 'image/jpeg'
    await thumbCache.put(cacheKey, data, type).catch(() => undefined)
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.send(data)
  } catch (error) {
    return next(error)
  }
})

driveIndexRouter.get('/:id/view-url', async (req: AuthRequest, res, next) => {
  try {
    const item = await prisma.driveItem.findFirstOrThrow({ where: { id: String(req.params.id), userId: req.user!.id }, select: { id: true, name: true, mimeType: true } })
    const token = jwt.sign({ typ: 'drive-view', sub: item.id }, env.JWT_ACCESS_SECRET, { expiresIn: '20m' })
    return res.json({ path: `/drive-view/${token}`, name: item.name, mimeType: item.mimeType })
  } catch (error) {
    return next(error)
  }
})

driveViewRouter.get('/:token', async (req, res, next) => {
  try {
    let payload: { typ?: string; sub?: string }
    try {
      payload = jwt.verify(String(req.params.token), env.JWT_ACCESS_SECRET) as { typ?: string; sub?: string }
    } catch {
      return res.status(401).json({ code: 'VIEW_LINK_EXPIRED', message: 'This preview link has expired. Reopen the file.' })
    }
    if (payload.typ !== 'drive-view' || !payload.sub) return res.status(401).json({ code: 'VIEW_LINK_INVALID', message: 'Invalid preview link.' })
    const item = await prisma.driveItem.findUnique({ where: { id: payload.sub }, include: { connectedAccount: true } })
    if (!item || item.connectedAccount.status !== 'connected') return res.status(404).json({ code: 'NOT_FOUND', message: 'File not found.' })
    return streamGoogleFile(item as unknown as Parameters<typeof streamGoogleFile>[0] & { providerFileId: string }, req.headers.range, res, { disposition: 'inline' })
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
