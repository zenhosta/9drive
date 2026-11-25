import type { MoveJob, MoveJobItem } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { syncGoogleQuota } from '../google/google.service.js'
import { DAILY_UPLOAD_LIMIT_BYTES, isNativeGoogleMime, MAX_FOLDER_MOVE_ITEMS, nativeExportFor, subpathFor, TARGET_SAFETY_MARGIN_BYTES } from './move-logic.js'
import { kickMoveRunner } from './move-runner.js'
import { driveFor, resolveFolder } from '../google/google-copy.js'
import { classifyDriveError } from './move-logic.js'

export type MoveOptions = { includeNative: boolean; nativeFormat: 'native' | 'office'; targetFolderId?: string; targetFolderPath?: string; operation?: 'move' | 'copy' | 'delete'; permanent?: boolean }
export type RequestedMove = { fileId?: string; driveItemId?: string; targetAccountId: string; subpath?: string }

export class JobRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

type Candidate = {
  fileId?: string
  driveItemId?: string
  name: string
  mimeType: string
  sizeBytes: bigint
  accountId: string
  providerFileId: string
  active: boolean
  sourceConnected: boolean
  sourceIsGoogle: boolean
  targetAccountId: string
  subpath?: string
}

/**
 * Validates a set of requested moves and persists a job. Anything that can't be moved is reported back as
 * "skipped" with a reason instead of failing the whole request.
 * A request can name 9Drive files (fileId) or files from the Drive index (driveItemId). An indexed file that 9Drive
 * also tracks is moved as the tracked file so its share links and virtual folder are preserved.
 */
export async function createMoveJob(userId: string, type: 'move' | 'rebalance', requested: RequestedMove[], options: MoveOptions, sourceAccountId?: string) {
  const fileIds = [...new Set(requested.flatMap((r) => (r.fileId ? [r.fileId] : [])))]
  const itemIds = [...new Set(requested.flatMap((r) => (r.driveItemId ? [r.driveItemId] : [])))]
  const accountSelect = { id: true, email: true, provider: true, status: true } as const

  const files = fileIds.length ? await prisma.file.findMany({ where: { id: { in: fileIds }, userId }, include: { connectedAccount: { select: accountSelect } } }) : []
  const driveItems = itemIds.length ? await prisma.driveItem.findMany({ where: { id: { in: itemIds }, userId }, include: { connectedAccount: { select: accountSelect } } }) : []
  const fileById = new Map(files.map((f) => [f.id, f]))
  const itemById = new Map(driveItems.map((d) => [d.id, d]))

  // Indexed files that 9Drive also tracks.
  const tracked = new Map<string, (typeof files)[number]>()
  for (let i = 0; i < driveItems.length; i += 300) {
    const chunk = driveItems.slice(i, i + 300)
    const rows = await prisma.file.findMany({
      where: { userId, status: 'active', OR: chunk.map((d) => ({ connectedAccountId: d.connectedAccountId, providerFileId: d.providerFileId })) },
      include: { connectedAccount: { select: accountSelect } },
    })
    for (const f of rows) tracked.set(`${f.connectedAccountId}:${f.providerFileId}`, f)
  }

  const targetIds = [...new Set(requested.map((r) => r.targetAccountId))]
  const targets = await prisma.connectedAccount.findMany({ where: { id: { in: targetIds }, userId, provider: 'google_drive', status: 'connected' }, include: { storageAccount: true } })
  const targetById = new Map(targets.map((t) => [t.id, t]))

  // Fresh numbers for the free-space check.
  await Promise.allSettled(targets.map((t) => syncGoogleQuota(t.id)))
  const freshQuota = new Map((await prisma.storageAccount.findMany({ where: { connectedAccountId: { in: targets.map((t) => t.id) } } })).map((s) => [s.connectedAccountId, s]))

  const accepted: Candidate[] = []
  const skipped: Array<{ fileId: string; name: string; reason: string }> = []
  const seen = new Set<string>()

  for (const req of requested) {
    const refId = req.fileId ?? req.driveItemId ?? ''
    let c: Candidate | null = null
    const skip = (reason: string, name?: string) => skipped.push({ fileId: refId, name: name ?? refId, reason })

    if (req.fileId) {
      const f = fileById.get(req.fileId)
      if (!f) { skip('File not found.'); continue }
      c = { fileId: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, accountId: f.connectedAccountId, providerFileId: f.providerFileId, active: f.status === 'active' && f.provider === 'google_drive', sourceConnected: f.connectedAccount.status === 'connected', sourceIsGoogle: f.connectedAccount.provider === 'google_drive', targetAccountId: req.targetAccountId }
    } else if (req.driveItemId) {
      const d = itemById.get(req.driveItemId)
      if (!d) { skip('File not found in the drive index. Scan the drives again.'); continue }
      const t = tracked.get(`${d.connectedAccountId}:${d.providerFileId}`)
      c = t
        ? { fileId: t.id, name: t.name, mimeType: t.mimeType, sizeBytes: t.sizeBytes, accountId: t.connectedAccountId, providerFileId: t.providerFileId, active: true, sourceConnected: t.connectedAccount.status === 'connected', sourceIsGoogle: true, targetAccountId: req.targetAccountId }
        : { driveItemId: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes, accountId: d.connectedAccountId, providerFileId: d.providerFileId, active: true, sourceConnected: d.connectedAccount.status === 'connected', sourceIsGoogle: d.connectedAccount.provider === 'google_drive', targetAccountId: req.targetAccountId }
    }
    if (!c) { skip('Nothing to move.'); continue }
    const dedupe = `${c.accountId}:${c.providerFileId}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    if (!c.active) { skip('File is not active.', c.name); continue }
    if (!c.sourceIsGoogle) { skip('Only Google Drive files can be moved.', c.name); continue }
    if (!c.sourceConnected) { skip('The file\'s current drive is disconnected.', c.name); continue }
    if (sourceAccountId && c.accountId !== sourceAccountId) { skip('File is not on the selected source drive.', c.name); continue }
    if (!targetById.has(c.targetAccountId)) { skip('Target drive is not a connected Google Drive account.', c.name); continue }
    if (c.accountId === c.targetAccountId) { skip('File is already on that drive.', c.name); continue }
    const native = isNativeGoogleMime(c.mimeType)
    if (native && !options.includeNative) { skip('Native Google file (Doc/Sheet/Slide/Drawing). Enable "include Google Docs, Sheets and Slides" to move it.', c.name); continue }
    if (native && !nativeExportFor(c.mimeType)) { skip('This type of Google file (form, script, site or shortcut) cannot be moved.', c.name); continue }
    c.subpath = req.subpath
    accepted.push(c)
  }

  if (accepted.length === 0) throw new JobRequestError(400, 'NOTHING_TO_MOVE', 'None of the selected files can be moved.', { skipped })

  // Optional destination folder: one target drive, and the folder must exist and accept files.
  let jobOptions: MoveOptions = { includeNative: options.includeNative, nativeFormat: options.nativeFormat, operation: options.operation ?? 'move' }
  if (options.targetFolderId) {
    const targetIdsUsed = [...new Set(accepted.map((a) => a.targetAccountId))]
    if (targetIdsUsed.length !== 1) throw new JobRequestError(400, 'BAD_TARGET_FOLDER', 'A destination folder can only be used when moving to a single drive.')
    try {
      const { drive } = await driveFor(targetById.get(targetIdsUsed[0])!)
      const folder = await resolveFolder(drive, options.targetFolderId)
      jobOptions = { ...jobOptions, targetFolderId: folder.id, targetFolderPath: folder.path }
    } catch (error) {
      const c = classifyDriveError(error)
      throw new JobRequestError(400, 'BAD_TARGET_FOLDER', c.status === 404 ? 'The destination folder no longer exists.' : `The destination folder cannot be used: ${c.message}`)
    }
  }

  const bytesOf = (c: Candidate) => (isNativeGoogleMime(c.mimeType) ? 0n : c.sizeBytes)
  const bytesByTarget = new Map<string, bigint>()
  for (const a of accepted) bytesByTarget.set(a.targetAccountId, (bytesByTarget.get(a.targetAccountId) ?? 0n) + bytesOf(a))
  const warnings: string[] = []
  for (const [targetId, bytes] of bytesByTarget) {
    const available = freshQuota.get(targetId)?.availableBytes ?? null
    const email = targetById.get(targetId)!.email
    if (available !== null && available < bytes + TARGET_SAFETY_MARGIN_BYTES) {
      throw new JobRequestError(409, 'TARGET_FULL', `${email} does not have enough free space for this move.`, { targetAccountId: targetId, neededBytes: bytes.toString(), availableBytes: available.toString() })
    }
    if (bytes > DAILY_UPLOAD_LIMIT_BYTES) warnings.push(`${email} would receive more than ~750 GB, above Google's daily upload limit. Expect rate limiting; consider splitting the move.`)
  }
  const nativeCount = accepted.filter((a) => isNativeGoogleMime(a.mimeType)).length
  if (nativeCount > 0) warnings.push(`${nativeCount} native Google file(s) will get a new Drive file ID and lose Google-side revision history, comments and Google sharing. 9Drive name, folder and share links are kept.`)
  if (!jobOptions.targetFolderId && accepted.some((a) => a.driveItemId)) warnings.push('Files that were not in the 9drive folder are copied into the target drive\'s 9drive folder, so they leave their old folder path.')

  const job = await prisma.moveJob.create({
    data: {
      userId,
      type: options.operation === 'copy' ? 'copy' : type,
      status: 'queued',
      options: jobOptions,
      totalItems: accepted.length,
      totalBytes: accepted.reduce((sum, a) => sum + bytesOf(a), 0n),
      items: {
        create: accepted.map((a) => ({
          fileId: a.fileId ?? null,
          driveItemId: a.driveItemId ?? null,
          targetSubpath: a.subpath ? a.subpath.slice(0, 1000) : null,
          fileName: a.name,
          sourceAccountId: a.accountId,
          targetAccountId: a.targetAccountId,
          sourceProviderFileId: a.providerFileId,
          bytes: bytesOf(a),
        })),
      },
    },
  })
  kickMoveRunner()
  return { job, accepted: accepted.length, skipped, warnings }
}

/** Expands selected folders into their indexed files, each tagged with the sub-path that recreates the structure. */
export async function expandFolders(userId: string, folders: Array<{ accountId: string; path: string }>, targetAccountId: string): Promise<RequestedMove[]> {
  const out: RequestedMove[] = []
  for (const folder of folders) {
    const path = folder.path.replace(/\/+$/, '')
    if (!path || path === 'My Drive') throw new JobRequestError(400, 'BAD_FOLDER', 'Select a folder inside the drive, not the whole drive.')
    const items = await prisma.driveItem.findMany({
      where: { userId, connectedAccountId: folder.accountId, OR: [{ path }, { path: { startsWith: `${path}/` } }] },
      select: { id: true, path: true },
      take: MAX_FOLDER_MOVE_ITEMS + 1,
    })
    for (const item of items) out.push({ driveItemId: item.id, targetAccountId, subpath: subpathFor(path, item.path) })
    if (out.length > MAX_FOLDER_MOVE_ITEMS) throw new JobRequestError(400, 'FOLDER_TOO_LARGE', `That selection has more than ${MAX_FOLDER_MOVE_ITEMS.toLocaleString()} files. Move it in smaller parts.`)
  }
  return out
}

/** Delete files from Drive (to the Drive trash, or permanently) as a background job with progress, cancel and retry. */
export async function createDeleteJob(userId: string, driveItemIds: string[], permanent: boolean) {
  const ids = [...new Set(driveItemIds)]
  if (ids.length === 0) throw new JobRequestError(400, 'NOTHING_TO_DELETE', 'Select at least one file.')
  if (ids.length > MAX_FOLDER_MOVE_ITEMS) throw new JobRequestError(400, 'TOO_MANY_FILES', `Delete at most ${MAX_FOLDER_MOVE_ITEMS.toLocaleString()} files at a time.`)
  const items = await prisma.driveItem.findMany({ where: { id: { in: ids }, userId, connectedAccount: { provider: 'google_drive', status: 'connected' } } })
  if (items.length === 0) throw new JobRequestError(400, 'NOTHING_TO_DELETE', 'None of the selected files can be deleted (not found or the drive is disconnected).')
  const job = await prisma.moveJob.create({
    data: {
      userId,
      type: 'delete',
      status: 'queued',
      options: { includeNative: false, nativeFormat: 'native', operation: 'delete', permanent },
      totalItems: items.length,
      totalBytes: items.reduce((sum, i) => sum + i.sizeBytes, 0n),
      items: { create: items.map((i) => ({ driveItemId: i.id, fileName: i.name, sourceAccountId: i.connectedAccountId, targetAccountId: i.connectedAccountId, sourceProviderFileId: i.providerFileId, bytes: i.sizeBytes })) },
    },
  })
  kickMoveRunner()
  return { job, count: items.length, skipped: ids.length - items.length }
}

export function serializeJob(job: MoveJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    options: job.options,
    totalItems: job.totalItems,
    doneItems: job.doneItems,
    failedItems: job.failedItems,
    skippedItems: job.skippedItems,
    totalBytes: job.totalBytes.toString(),
    movedBytes: job.movedBytes.toString(),
    cancelRequested: job.cancelRequested,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

export function serializeItem(item: MoveJobItem) {
  return {
    id: item.id,
    fileId: item.fileId,
    driveItemId: item.driveItemId,
    fileName: item.fileName,
    sourceAccountId: item.sourceAccountId,
    targetAccountId: item.targetAccountId,
    bytes: item.bytes.toString(),
    status: item.status,
    step: item.step,
    attempts: item.attempts,
    error: item.error,
    note: item.note,
    updatedAt: item.updatedAt,
  }
}
