// Pure helpers for moving files between Drive accounts. No I/O here so they can be unit tested.

export const NATIVE_PREFIX = 'application/vnd.google-apps.'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Free space kept untouched on a target drive. */
export const TARGET_SAFETY_MARGIN_BYTES = 100n * 1024n * 1024n
/** Rebalance will not fill a target beyond this share of its capacity. */
export const MAX_TARGET_USED_PERCENT = 90
/** Google's per-account daily upload cap (approx). */
export const DAILY_UPLOAD_LIMIT_BYTES = 750n * 1024n ** 3n
/** Drive's files.export hard limit (approx). */
export const EXPORT_LIMIT_BYTES = 10 * 1024 * 1024

export const MAX_ITEM_ATTEMPTS = 5

export function isNativeGoogleMime(mime: string) {
  return mime.startsWith(NATIVE_PREFIX) && mime !== FOLDER_MIME
}

export type NativeExport = { exportMime: string; extension: string; convertBack: boolean }

const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const NATIVE_EXPORTS: Record<string, NativeExport> = {
  'application/vnd.google-apps.document': { exportMime: OFFICE.docx, extension: '.docx', convertBack: true },
  'application/vnd.google-apps.spreadsheet': { exportMime: OFFICE.xlsx, extension: '.xlsx', convertBack: true },
  'application/vnd.google-apps.presentation': { exportMime: OFFICE.pptx, extension: '.pptx', convertBack: true },
  // Drawings cannot be re-imported as a native drawing, so they always end up as PNG images.
  'application/vnd.google-apps.drawing': { exportMime: 'image/png', extension: '.png', convertBack: false },
}

/** Returns null for native types that cannot be moved at all (forms, scripts, sites, shortcuts...). */
export function nativeExportFor(mime: string): NativeExport | null {
  return NATIVE_EXPORTS[mime] ?? null
}

export function withExtension(name: string, extension: string) {
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`
}

export type ErrorClass = { retryable: boolean; status?: number; reason?: string; message: string }

const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'sharingRateLimitExceeded', 'backendError', 'internalError'])
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])

/** Works for googleapis errors (code/errors[]), our DriveHttpError (status/reason) and fetch/network errors. */
export function classifyDriveError(err: unknown): ErrorClass {
  const e = err as { status?: number; code?: number | string; reason?: string; errors?: Array<{ reason?: string }>; cause?: { code?: string }; message?: string } | null
  const message = e?.message ?? 'Unknown error'
  const numeric = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined
  const reason = e?.reason ?? e?.errors?.[0]?.reason
  if (numeric === 429) return { retryable: true, status: numeric, reason, message }
  if (numeric !== undefined && numeric >= 500) return { retryable: true, status: numeric, reason, message }
  if (numeric === 403) return { retryable: reason ? RETRYABLE_REASONS.has(reason) : false, status: numeric, reason, message }
  if (numeric !== undefined) return { retryable: false, status: numeric, reason, message }
  const netCode = (typeof e?.code === 'string' ? e.code : undefined) ?? e?.cause?.code
  if ((netCode && NETWORK_CODES.has(netCode)) || /fetch failed|socket hang up|network/i.test(message)) return { retryable: true, reason: netCode, message }
  return { retryable: false, reason, message }
}

/** Exponential backoff with jitter: 1s, 2s, 4s, ... capped at 60s. `random` is injectable for tests. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random) {
  const base = Math.min(60_000, 1000 * 2 ** attempt)
  return Math.round(base / 2 + random() * (base / 2))
}

export type DriveMeta = { size?: string | null; md5Checksum?: string | null; trashed?: boolean | null; mimeType?: string | null }

/** Compares the copy on the target against what the source reported. Returns an error message or null. */
export function verifyCopy(source: DriveMeta, target: DriveMeta): string | null {
  if (!target) return 'Target file not found.'
  if (target.trashed) return 'Target file is in the trash.'
  if (source.size != null && target.size != null && String(source.size) !== String(target.size)) return `Size mismatch (source ${source.size}, target ${target.size}).`
  if (source.size != null && Number(source.size) > 0 && target.size == null) return 'Target reports no size.'
  if (source.md5Checksum && target.md5Checksum && source.md5Checksum.toLowerCase() !== target.md5Checksum.toLowerCase()) return 'Checksum (md5) mismatch.'
  if (source.md5Checksum && !target.md5Checksum) return 'Target did not report a checksum to verify against.'
  return null
}

export type ItemCounts = { queued: number; running: number; done: number; failed: number; cancelled: number; skipped: number }

export function computeJobStatus(c: ItemCounts, cancelRequested: boolean): 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' {
  if (c.running > 0) return 'running'
  if (c.queued > 0) return c.done + c.failed + c.skipped + c.cancelled > 0 ? 'running' : 'queued'
  if (cancelRequested && c.cancelled > 0) return 'cancelled'
  if (c.failed > 0 && c.done === 0) return 'failed'
  if (c.failed > 0) return 'completed_with_errors'
  return 'completed'
}

/**
 * Destination sub-path for a file inside a selected folder, so the structure is kept like Google Drive does:
 * moving "My Drive/Photos" and a file at "My Drive/Photos/2023" gives "Photos/2023"; a file directly in it gives "Photos".
 */
export function subpathFor(folderPath: string, itemPath: string) {
  const folder = folderPath.replace(/\/+$/, '')
  const name = folder.split('/').pop() ?? ''
  const rest = itemPath === folder ? '' : itemPath.startsWith(`${folder}/`) ? itemPath.slice(folder.length + 1) : ''
  return [name, rest].filter(Boolean).join('/')
}

export function splitSubpath(subpath: string | null | undefined) {
  return (subpath ?? '').split('/').map((s) => s.trim()).filter(Boolean)
}

export const MAX_FOLDER_MOVE_ITEMS = 10000
