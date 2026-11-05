import type { ConnectedAccount } from '@prisma/client'
import { google, type drive_v3 } from 'googleapis'
import { Readable } from 'node:stream'
import { EXPORT_LIMIT_BYTES, type DriveMeta } from '../jobs/move-logic.js'
import { getAuthedGoogleClient } from './google.service.js'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

/** Error carrying the HTTP status and Google error reason so classifyDriveError() can decide about retries. */
export class DriveHttpError extends Error {
  constructor(message: string, public status: number, public reason?: string) {
    super(message)
    this.name = 'DriveHttpError'
  }
}

async function failFromResponse(response: Response, what: string): Promise<never> {
  const text = await response.text().catch(() => '')
  let reason: string | undefined
  let message = text || response.statusText
  try {
    const json = JSON.parse(text) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    reason = json.error?.errors?.[0]?.reason
    message = json.error?.message ?? message
  } catch { /* not JSON */ }
  throw new DriveHttpError(`${what}: ${message}`, response.status, reason)
}

export async function driveFor(account: ConnectedAccount) {
  const auth = await getAuthedGoogleClient(account)
  return { auth, drive: google.drive({ version: 'v3', auth }) }
}

async function authHeaders(account: ConnectedAccount) {
  const { auth } = await driveFor(account)
  const headers = await auth.getRequestHeaders()
  // google-auth-library returns a Headers instance in recent versions, a plain object in older ones.
  return (headers instanceof Headers ? Object.fromEntries(headers.entries()) : Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)]))) as Record<string, string>
}

export type SourceMeta = DriveMeta & { id: string; name: string; mimeType: string }

export async function getFileMeta(drive: drive_v3.Drive, fileId: string): Promise<SourceMeta & { appProperties?: Record<string, string> | null }> {
  const res = await drive.files.get({ fileId, fields: 'id,name,mimeType,size,md5Checksum,trashed,appProperties' })
  const d = res.data
  return { id: d.id!, name: d.name ?? '', mimeType: d.mimeType ?? '', size: d.size ?? null, md5Checksum: d.md5Checksum ?? null, trashed: d.trashed ?? false, appProperties: d.appProperties ?? null }
}

/** Finds a file that a previous attempt of this move item already created on the target (crash recovery). */
export async function findCopyByItem(drive: drive_v3.Drive, itemId: string): Promise<string | null> {
  const res = await drive.files.list({
    q: `appProperties has { key='nineDriveMoveItem' and value='${itemId}' } and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    spaces: 'drive',
  })
  return res.data.files?.[0]?.id ?? null
}

/**
 * Streams a binary file from the source account straight into a resumable upload on the target account.
 * Nothing is written to disk and the file is never held in memory.
 */
export async function streamCopy(opts: {
  source: ConnectedAccount
  target: ConnectedAccount
  sourceFileId: string
  sizeBytes: bigint
  name: string
  mimeType: string
  parentId: string
  itemId: string
}): Promise<{ id: string }> {
  const sourceHeaders = await authHeaders(opts.source)
  const download = await fetch(`${DRIVE_API}/files/${opts.sourceFileId}?alt=media&supportsAllDrives=true`, { headers: sourceHeaders })
  if (!download.ok) await failFromResponse(download, 'Source download failed')

  try {
    const targetHeaders = await authHeaders(opts.target)
    const init = await fetch(`${UPLOAD_API}/files?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: {
        ...targetHeaders,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': opts.mimeType,
        'X-Upload-Content-Length': opts.sizeBytes.toString(),
      },
      body: JSON.stringify({ name: opts.name, parents: [opts.parentId], appProperties: { nineDriveMoveItem: opts.itemId } }),
    })
    if (!init.ok) await failFromResponse(init, 'Target upload could not start')
    const sessionUri = init.headers.get('location')
    if (!sessionUri) throw new DriveHttpError('Google did not return an upload session URL.', 502)

    const put = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Length': opts.sizeBytes.toString(), 'Content-Type': opts.mimeType },
      body: opts.sizeBytes === 0n || !download.body ? undefined : (download.body as unknown as BodyInit),
      duplex: 'half',
    } as RequestInit)
    if (!put.ok) await failFromResponse(put, 'Target upload failed')
    const created = (await put.json()) as { id?: string }
    if (!created.id) throw new DriveHttpError('Target upload returned no file id.', 502)
    return { id: created.id }
  } catch (error) {
    await download.body?.cancel().catch(() => undefined)
    throw error
  }
}

/** Exports a Google-native file. Exports are capped by Google at ~10 MB, so a bounded in-memory buffer is used (never disk). */
export async function exportToBuffer(account: ConnectedAccount, fileId: string, exportMime: string): Promise<Buffer> {
  const headers = await authHeaders(account)
  const response = await fetch(`${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`, { headers })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const tooLarge = response.status === 403 && /exportSizeLimitExceeded|too large/i.test(text)
    throw new DriveHttpError(tooLarge ? 'File is too large for Google to export (about 10 MB limit).' : `Export failed: ${text || response.statusText}`, response.status, tooLarge ? 'exportSizeLimitExceeded' : undefined)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length
    if (total > EXPORT_LIMIT_BYTES + 1024 * 1024) throw new DriveHttpError('Exported file exceeds the export size limit.', 403, 'exportSizeLimitExceeded')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function uploadBuffer(opts: { target: ConnectedAccount; buffer: Buffer; name: string; mediaMime: string; fileMime?: string; parentId: string; itemId: string }): Promise<{ id: string }> {
  const { drive } = await driveFor(opts.target)
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.parentId], appProperties: { nineDriveMoveItem: opts.itemId }, ...(opts.fileMime ? { mimeType: opts.fileMime } : {}) },
    media: { mimeType: opts.mediaMime, body: Readable.from(opts.buffer) },
    fields: 'id',
  })
  if (!res.data.id) throw new DriveHttpError('Target upload returned no file id.', 502)
  return { id: res.data.id }
}

export async function makePublicWriter(drive: drive_v3.Drive, fileId: string) {
  await drive.permissions.create({ fileId, requestBody: { role: 'writer', type: 'anyone' } })
}

export async function deleteDriveFile(drive: drive_v3.Drive, fileId: string) {
  await drive.files.delete({ fileId })
}

/** Fallback when permanent delete is not allowed (e.g. the account is not the owner). Never empties the whole trash. */
export async function trashDriveFile(drive: drive_v3.Drive, fileId: string) {
  await drive.files.update({ fileId, requestBody: { trashed: true } })
}
