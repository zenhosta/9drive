import type { MoveJob, MoveJobItem } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { syncGoogleQuota } from '../google/google.service.js'
import { DAILY_UPLOAD_LIMIT_BYTES, isNativeGoogleMime, nativeExportFor, TARGET_SAFETY_MARGIN_BYTES } from './move-logic.js'
import { kickMoveRunner } from './move-runner.js'

export type MoveOptions = { includeNative: boolean; nativeFormat: 'native' | 'office' }
export type RequestedMove = { fileId: string; targetAccountId: string }

export class JobRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

/**
 * Validates a set of requested moves and persists a job. Anything that can't be moved is reported back as
 * "skipped" with a reason instead of failing the whole request.
 */
export async function createMoveJob(userId: string, type: 'move' | 'rebalance', requested: RequestedMove[], options: MoveOptions, sourceAccountId?: string) {
  const fileIds = [...new Set(requested.map((r) => r.fileId))]
  const files = await prisma.file.findMany({ where: { id: { in: fileIds }, userId }, include: { connectedAccount: { select: { id: true, email: true, provider: true, status: true } } } })
  const fileById = new Map(files.map((f) => [f.id, f]))
  const targetIds = [...new Set(requested.map((r) => r.targetAccountId))]
  const targets = await prisma.connectedAccount.findMany({ where: { id: { in: targetIds }, userId, provider: 'google_drive', status: 'connected' }, include: { storageAccount: true } })
  const targetById = new Map(targets.map((t) => [t.id, t]))

  // Fresh numbers for the free-space check.
  await Promise.allSettled(targets.map((t) => syncGoogleQuota(t.id)))
  const freshQuota = new Map((await prisma.storageAccount.findMany({ where: { connectedAccountId: { in: targets.map((t) => t.id) } } })).map((s) => [s.connectedAccountId, s]))

  const accepted: Array<{ file: (typeof files)[number]; targetAccountId: string; bytes: bigint }> = []
  const skipped: Array<{ fileId: string; name: string; reason: string }> = []
  const seen = new Set<string>()

  for (const req of requested) {
    if (seen.has(req.fileId)) continue
    seen.add(req.fileId)
    const file = fileById.get(req.fileId)
    const skip = (reason: string) => skipped.push({ fileId: req.fileId, name: file?.name ?? req.fileId, reason })
    if (!file || file.status !== 'active') { skip('File not found or not active.'); continue }
    if (file.provider !== 'google_drive' || file.connectedAccount.provider !== 'google_drive') { skip('Only Google Drive files can be moved.'); continue }
    if (file.connectedAccount.status !== 'connected') { skip('The file\'s current drive is disconnected.'); continue }
    if (sourceAccountId && file.connectedAccountId !== sourceAccountId) { skip('File is not on the selected source drive.'); continue }
    if (!targetById.has(req.targetAccountId)) { skip('Target drive is not a connected Google Drive account.'); continue }
    if (file.connectedAccountId === req.targetAccountId) { skip('File is already on that drive.'); continue }
    const native = isNativeGoogleMime(file.mimeType)
    if (native && !options.includeNative) { skip('Native Google file (Doc/Sheet/Slide/Drawing). Enable "include Google Docs, Sheets and Slides" to move it.'); continue }
    if (native && !nativeExportFor(file.mimeType)) { skip('This type of Google file (form, script, site or shortcut) cannot be moved.'); continue }
    accepted.push({ file, targetAccountId: req.targetAccountId, bytes: native ? 0n : file.sizeBytes })
  }

  if (accepted.length === 0) throw new JobRequestError(400, 'NOTHING_TO_MOVE', 'None of the selected files can be moved.', { skipped })

  const bytesByTarget = new Map<string, bigint>()
  for (const a of accepted) bytesByTarget.set(a.targetAccountId, (bytesByTarget.get(a.targetAccountId) ?? 0n) + a.bytes)
  const warnings: string[] = []
  for (const [targetId, bytes] of bytesByTarget) {
    const available = freshQuota.get(targetId)?.availableBytes ?? null
    const email = targetById.get(targetId)!.email
    if (available !== null && available < bytes + TARGET_SAFETY_MARGIN_BYTES) {
      throw new JobRequestError(409, 'TARGET_FULL', `${email} does not have enough free space for this move.`, { targetAccountId: targetId, neededBytes: bytes.toString(), availableBytes: available.toString() })
    }
    if (bytes > DAILY_UPLOAD_LIMIT_BYTES) warnings.push(`${email} would receive more than ~750 GB, above Google's daily upload limit. Expect rate limiting; consider splitting the move.`)
  }
  const nativeCount = accepted.filter((a) => isNativeGoogleMime(a.file.mimeType)).length
  if (nativeCount > 0) warnings.push(`${nativeCount} native Google file(s) will get a new Drive file ID and lose Google-side revision history, comments and Google sharing. 9Drive name, folder and share links are kept.`)

  const job = await prisma.moveJob.create({
    data: {
      userId,
      type,
      status: 'queued',
      options,
      totalItems: accepted.length,
      totalBytes: accepted.reduce((sum, a) => sum + a.bytes, 0n),
      items: {
        create: accepted.map((a) => ({
          fileId: a.file.id,
          fileName: a.file.name,
          sourceAccountId: a.file.connectedAccountId,
          targetAccountId: a.targetAccountId,
          sourceProviderFileId: a.file.providerFileId,
          bytes: a.bytes,
        })),
      },
    },
  })
  kickMoveRunner()
  return { job, accepted: accepted.length, skipped, warnings }
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
