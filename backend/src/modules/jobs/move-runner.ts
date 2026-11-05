import type { ConnectedAccount, File, MoveJobItem } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { createAuditLog } from '../../utils/audit.js'
import { deleteDriveFile, driveFor, exportToBuffer, findCopyByItem, getFileMeta, makePublicWriter, streamCopy, trashDriveFile, uploadBuffer } from '../google/google-copy.js'
import { ensureGoogleAppFolder, syncGoogleQuota } from '../google/google.service.js'
import {
  backoffDelayMs,
  classifyDriveError,
  computeJobStatus,
  isNativeGoogleMime,
  MAX_ITEM_ATTEMPTS,
  nativeExportFor,
  TARGET_SAFETY_MARGIN_BYTES,
  verifyCopy,
  withExtension,
  type ItemCounts,
} from './move-logic.js'

/*
 * Move worker. Each MoveJobItem is a small state machine persisted in the DB so a restart resumes safely:
 *
 *   pending/copying -> copied -> db_updated -> done
 *
 * - The source file is only deleted after the copy is verified AND the DB row points at the copy.
 * - Any failure before db_updated removes the partial copy and leaves the original untouched.
 * - The target copy is tagged with appProperties.nineDriveMoveItem so a crash between "upload finished" and
 *   "id saved" can be recovered by adopting the copy instead of uploading a duplicate.
 * Assumes a single backend process (the compose setup runs one).
 */

const CONCURRENCY = 3
const POLL_MS = 3000

type JobOptions = { includeNative?: boolean; nativeFormat?: 'native' | 'office' }
type ItemWithJob = MoveJobItem & { job: { id: string; userId: string; options: unknown } }

class ItemFailure extends Error {}
class ItemCancelled extends Error {}

let running = 0
let pumping = false
let started = false
const reservedByTarget = new Map<string, bigint>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message: string, meta?: Record<string, unknown>) => console.info('[move]', message, meta ?? '')

export async function startMoveRunner() {
  if (started) return
  started = true
  // Items left "running" by a crash/restart go back to the queue; their persisted step decides where they resume.
  const recovered = await prisma.moveJobItem.updateMany({ where: { status: 'running' }, data: { status: 'queued' } })
  if (recovered.count > 0) log('recovered interrupted items', { count: recovered.count })
  const open = await prisma.moveJob.findMany({ where: { status: { in: ['queued', 'running'] } }, select: { id: true } })
  for (const job of open) await refreshJob(job.id).catch(() => undefined)
  setInterval(() => void pump(), POLL_MS).unref()
  void pump()
}

export function kickMoveRunner() {
  void pump()
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (running < CONCURRENCY) {
      const item = await claimNext()
      if (!item) break
      running += 1
      void processItem(item)
        .catch((error) => log('unexpected worker error', { itemId: item.id, message: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          running -= 1
          void pump()
        })
    }
  } catch (error) {
    log('pump failed', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    pumping = false
  }
}

async function claimNext(): Promise<ItemWithJob | null> {
  const next = await prisma.moveJobItem.findFirst({
    where: { status: 'queued', job: { cancelRequested: false } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!next) return null
  const claimed = await prisma.moveJobItem.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'running', attempts: { increment: 1 } } })
  if (claimed.count !== 1) return null
  const item = await prisma.moveJobItem.findUniqueOrThrow({ where: { id: next.id }, include: { job: { select: { id: true, userId: true, options: true } } } })
  await prisma.moveJob.updateMany({ where: { id: item.jobId, startedAt: null }, data: { startedAt: new Date(), status: 'running' } })
  return item
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      const c = classifyDriveError(error)
      if (!c.retryable || attempt >= 5) throw error
      log('retrying after transient error', { attempt: attempt + 1, status: c.status, reason: c.reason })
      await sleep(backoffDelayMs(attempt))
    }
  }
}

function friendly(error: unknown) {
  const c = classifyDriveError(error)
  if (c.reason === 'storageQuotaExceeded') return 'The target drive is out of storage space.'
  if (c.reason === 'dailyLimitExceeded' || c.reason === 'uploadLimit') return 'Google daily limit reached for this account. Retry later.'
  if (c.status === 404) return 'File not found in Google Drive.'
  if (c.status === 401) return 'Google rejected the credentials. Reconnect this drive.'
  return c.message
}

async function isCancelled(jobId: string) {
  const job = await prisma.moveJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } })
  return Boolean(job?.cancelRequested)
}

async function setItem(id: string, data: Partial<Pick<MoveJobItem, 'status' | 'step' | 'targetProviderFileId' | 'error' | 'note'>>) {
  await prisma.moveJobItem.update({ where: { id }, data })
}

async function processItem(item: ItemWithJob) {
  try {
    if (item.attempts > MAX_ITEM_ATTEMPTS) throw new ItemFailure('Gave up after too many attempts (the backend may be crashing on this file).')
    await runItem(item)
  } catch (error) {
    if (error instanceof ItemCancelled) {
      await cleanupTarget(item)
      await setItem(item.id, { status: 'cancelled', error: null })
    } else {
      const message = error instanceof ItemFailure ? error.message : friendly(error)
      log('item failed', { itemId: item.id, step: (await prisma.moveJobItem.findUnique({ where: { id: item.id }, select: { step: true } }))?.step, message })
      await cleanupTarget(item)
      await setItem(item.id, { status: 'failed', error: message.slice(0, 2000) })
    }
  } finally {
    await refreshJob(item.jobId).catch(() => undefined)
  }
}

async function loadAccount(id: string, userId: string) {
  return prisma.connectedAccount.findFirst({ where: { id, userId, provider: 'google_drive', status: 'connected' } })
}

async function runItem(item: ItemWithJob) {
  const options = (item.job.options ?? {}) as JobOptions
  const userId = item.job.userId
  const fresh = await prisma.moveJobItem.findUniqueOrThrow({ where: { id: item.id } })
  let step = fresh.step
  let targetId = fresh.targetProviderFileId

  const source = await loadAccount(item.sourceAccountId, userId)
  const target = await loadAccount(item.targetAccountId, userId)

  let file = await prisma.file.findFirst({ where: { id: item.fileId, userId } })
  if (!file) throw new ItemFailure('The file no longer exists in 9Drive.')

  // The DB row may already point at the copy if we crashed right after the update but before saving the step.
  if (targetId && file.connectedAccountId === item.targetAccountId && file.providerFileId === targetId && step !== 'db_updated') {
    step = 'db_updated'
    await setItem(item.id, { step })
  }

  if (step === 'pending' || step === 'copying') {
    if (!source || !target) throw new ItemFailure('Source or target drive is no longer connected.')
    if (file.status !== 'active' || file.connectedAccountId !== item.sourceAccountId || file.providerFileId !== item.sourceProviderFileId) {
      throw new ItemFailure('The file was changed, moved or deleted after the job was created.')
    }
    if (await isCancelled(item.jobId)) throw new ItemCancelled()
    targetId = await copyStep(item, file, source, target, options)
    await setItem(item.id, { step: 'copied', targetProviderFileId: targetId })
    step = 'copied'
  }

  if (step === 'copied') {
    if (!source || !target || !targetId) throw new ItemFailure('Source or target drive is no longer connected.')
    file = await prisma.file.findFirstOrThrow({ where: { id: item.fileId, userId } })
    if (await isCancelled(item.jobId)) throw new ItemCancelled()
    await verifyAndSwitch(item, file, source, target, targetId, options)
    await setItem(item.id, { step: 'db_updated' })
    step = 'db_updated'
  }

  if (step === 'db_updated') {
    const note = await deleteSourceStep(item, source)
    await prisma.moveJobItem.update({ where: { id: item.id }, data: { status: 'done', step: 'done', error: null, ...(note ? { note } : {}) } })
    log('item done', { itemId: item.id, fileId: item.fileId })
  }
}

async function copyStep(item: ItemWithJob, file: File, source: ConnectedAccount, target: ConnectedAccount, options: JobOptions): Promise<string> {
  const { drive: sourceDrive } = await driveFor(source)
  const { drive: targetDrive } = await driveFor(target)

  const meta = await withBackoff(() => getFileMeta(sourceDrive, item.sourceProviderFileId))
  if (meta.trashed) throw new ItemFailure('The source file is in the Drive trash.')
  const native = isNativeGoogleMime(meta.mimeType)
  const exp = native ? nativeExportFor(meta.mimeType) : null
  if (native && !exp) throw new ItemFailure('This kind of Google file (form, script, site or shortcut) cannot be moved.')
  if (native && !options.includeNative) throw new ItemFailure('Native Google files are only moved when "include Google Docs/Sheets/Slides" is enabled.')

  const needed = native ? 0n : BigInt(meta.size ?? 0)
  await reserveTargetSpace(target, needed, item.targetAccountId)
  try {
    const parentId = await ensureGoogleAppFolder(target)
    await setItem(item.id, { step: 'copying' })

    // Crash/retry safety: adopt a copy a previous attempt already finished.
    const existing = await findCopyByItem(targetDrive, item.id)
    if (existing) return existing

    if (!native) {
      const created = await withBackoff(async () => {
        const adopted = await findCopyByItem(targetDrive, item.id)
        if (adopted) return { id: adopted }
        return streamCopy({ source, target, sourceFileId: item.sourceProviderFileId, sizeBytes: needed, name: file.name, mimeType: meta.mimeType || file.mimeType, parentId, itemId: item.id })
      })
      return created.id
    }

    const buffer = await withBackoff(() => exportToBuffer(source, item.sourceProviderFileId, exp!.exportMime))
    if (buffer.length === 0) throw new ItemFailure('Google exported an empty file; the original was left untouched.')
    const keepNative = exp!.convertBack && options.nativeFormat !== 'office'
    const created = await withBackoff(async () => {
      const adopted = await findCopyByItem(targetDrive, item.id)
      if (adopted) return { id: adopted }
      return uploadBuffer({
        target,
        buffer,
        name: keepNative ? file.name : withExtension(file.name, exp!.extension),
        mediaMime: exp!.exportMime,
        fileMime: keepNative ? meta.mimeType : undefined,
        parentId,
        itemId: item.id,
      })
    })
    return created.id
  } finally {
    releaseTargetSpace(item.targetAccountId, needed)
  }
}

async function reserveTargetSpace(target: ConnectedAccount, bytes: bigint, targetId: string) {
  const quota = await withBackoff(() => syncGoogleQuota(target.id))
  const reserved = reservedByTarget.get(targetId) ?? 0n
  if (quota.availableBytes !== null && quota.availableBytes - reserved < bytes + TARGET_SAFETY_MARGIN_BYTES) {
    throw new ItemFailure(`Not enough free space on ${target.email} (needs ${bytes} bytes plus a safety margin, has ${quota.availableBytes - reserved}).`)
  }
  reservedByTarget.set(targetId, reserved + bytes)
}

function releaseTargetSpace(targetId: string, bytes: bigint) {
  const left = (reservedByTarget.get(targetId) ?? 0n) - bytes
  if (left > 0n) reservedByTarget.set(targetId, left)
  else reservedByTarget.delete(targetId)
}

async function verifyAndSwitch(item: ItemWithJob, file: File, source: ConnectedAccount, target: ConnectedAccount, targetId: string, options: JobOptions) {
  const { drive: sourceDrive } = await driveFor(source)
  const { drive: targetDrive } = await driveFor(target)
  const sourceMeta = await withBackoff(() => getFileMeta(sourceDrive, item.sourceProviderFileId))
  const targetMeta = await withBackoff(() => getFileMeta(targetDrive, targetId))
  const native = isNativeGoogleMime(sourceMeta.mimeType)
  const exp = native ? nativeExportFor(sourceMeta.mimeType) : null

  let problem: string | null
  let dbChanges: { name?: string; mimeType?: string; sizeBytes?: bigint } = {}
  if (!native) {
    problem = verifyCopy(sourceMeta, targetMeta)
  } else {
    const keepNative = Boolean(exp?.convertBack) && options.nativeFormat !== 'office'
    if (targetMeta.trashed) problem = 'Target file is in the trash.'
    else if (keepNative) problem = targetMeta.mimeType === sourceMeta.mimeType ? null : 'Target was not converted back to the native Google format.'
    else if (!targetMeta.size || Number(targetMeta.size) <= 0) problem = 'Target file is empty.'
    else {
      problem = null
      dbChanges = { name: withExtension(file.name, exp!.extension), mimeType: exp!.exportMime, sizeBytes: BigInt(targetMeta.size) }
    }
  }
  if (problem) throw new ItemFailure(`Verification failed, original kept: ${problem}`)

  // Re-point the 9Drive row at the copy. The WHERE guards make this idempotent and safe against concurrent edits.
  const updated = await prisma.file.updateMany({
    where: { id: file.id, status: 'active', connectedAccountId: item.sourceAccountId, providerFileId: item.sourceProviderFileId },
    data: { connectedAccountId: item.targetAccountId, providerFileId: targetId, ...(targetMeta.md5Checksum ? { checksum: targetMeta.md5Checksum } : {}), ...dbChanges },
  })
  if (updated.count !== 1) throw new ItemFailure('The file was changed or deleted while it was being moved; the original was kept.')

  // Match upload behaviour: files are shared as "anyone with the link" so view-url links keep working. Best effort.
  await makePublicWriter(targetDrive, targetId).catch((error) => log('could not set public permission on moved file', { itemId: item.id, message: error instanceof Error ? error.message : String(error) }))
}

async function deleteSourceStep(item: ItemWithJob, source: ConnectedAccount | null): Promise<string | null> {
  if (!source) return 'Copy verified and switched, but the source drive is disconnected so the original was not deleted.'
  const { drive } = await driveFor(source)
  try {
    await withBackoff(() => deleteDriveFile(drive, item.sourceProviderFileId))
    return null
  } catch (error) {
    const c = classifyDriveError(error)
    if (c.status === 404) return null
    try {
      await withBackoff(() => trashDriveFile(drive, item.sourceProviderFileId))
      return 'Copied OK, but permanent delete was refused, so the original was moved to the source drive trash. Empty that trash to free the space.'
    } catch {
      return `Copied OK, but the original could not be deleted (${friendly(error)}). Remove file ${item.sourceProviderFileId} from the source drive manually.`
    }
  }
}

/** Removes a partial/unused copy on the target. Never touches a copy the DB row already points at. */
async function cleanupTarget(item: MoveJobItem) {
  try {
    const current = await prisma.moveJobItem.findUnique({ where: { id: item.id } })
    if (!current || current.step === 'db_updated' || current.step === 'done') return
    const file = await prisma.file.findUnique({ where: { id: item.fileId }, select: { providerFileId: true } })
    const target = await prisma.connectedAccount.findUnique({ where: { id: item.targetAccountId } })
    if (!target || target.status !== 'connected') return
    const { drive } = await driveFor(target)
    const copyId = current.targetProviderFileId ?? (await findCopyByItem(drive, item.id).catch(() => null))
    if (copyId && file?.providerFileId !== copyId) {
      await deleteDriveFile(drive, copyId).catch((error) => {
        if (classifyDriveError(error).status !== 404) throw error
      })
    }
    await prisma.moveJobItem.update({ where: { id: item.id }, data: { targetProviderFileId: null, step: 'pending' } })
  } catch (error) {
    log('cleanup of partial copy failed', { itemId: item.id, message: error instanceof Error ? error.message : String(error) })
  }
}

export async function refreshJob(jobId: string) {
  const groups = await prisma.moveJobItem.groupBy({ by: ['status'], where: { jobId }, _count: { _all: true }, _sum: { bytes: true } })
  const counts: ItemCounts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0 }
  let movedBytes = 0n
  for (const g of groups) {
    if (g.status in counts) counts[g.status as keyof ItemCounts] = g._count._all
    if (g.status === 'done') movedBytes = g._sum.bytes ?? 0n
  }
  const job = await prisma.moveJob.findUnique({ where: { id: jobId } })
  if (!job) return
  const status = computeJobStatus(counts, job.cancelRequested)
  const terminal = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status)
  await prisma.moveJob.update({
    where: { id: jobId },
    data: { status, doneItems: counts.done, failedItems: counts.failed, skippedItems: counts.skipped, movedBytes },
  })
  if (!terminal) return
  // Only one finisher runs the post-actions.
  const claimed = await prisma.moveJob.updateMany({ where: { id: jobId, finishedAt: null }, data: { finishedAt: new Date() } })
  if (claimed.count !== 1) return
  const accounts = await prisma.moveJobItem.findMany({ where: { jobId }, select: { sourceAccountId: true, targetAccountId: true } })
  const ids = new Set(accounts.flatMap((a) => [a.sourceAccountId, a.targetAccountId]))
  await Promise.allSettled([...ids].map((id) => syncGoogleQuota(id)))
  await createAuditLog(job.userId, 'MOVE_JOB_FINISHED', 'move_job', jobId, { status, ...counts, movedBytes: movedBytes.toString() }).catch(() => undefined)
}
