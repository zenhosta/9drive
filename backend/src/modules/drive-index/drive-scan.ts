import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { google } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { withBackoff } from '../google/backoff.js'
import { getAuthedGoogleClient } from '../google/google.service.js'
import { FOLDER_MIME } from '../jobs/move-logic.js'

/*
 * Indexes every file the user OWNS in a connected Google Drive (anywhere, not just the 9drive folder) into
 * drive_items so it can be browsed, filtered and moved. Files shared with the user are skipped: they don't use
 * this account's quota and can't be moved away.
 * A scan stamps every row with a fresh scan_id and removes rows from older scans at the end, so a failed or
 * interrupted scan never wipes the previous index.
 */

const running = new Set<string>()
const CHUNK = 400

type FolderNode = { name: string; parent: string | null }

export function buildPath(folderId: string | undefined, folders: Map<string, FolderNode>, rootId: string) {
  const parts: string[] = []
  let current = folderId
  for (let depth = 0; current && depth < 60; depth += 1) {
    if (current === rootId) return ['My Drive', ...parts.reverse()].join('/').slice(0, 1000)
    const node = folders.get(current)
    if (!node) { parts.push('(shared folder)'); break }
    parts.push(node.name)
    current = node.parent ?? undefined
  }
  return ['My Drive', ...parts.reverse()].join('/').slice(0, 1000)
}

export function isScanRunning(accountId: string) {
  return running.has(accountId)
}

export async function recoverScans() {
  await prisma.driveScan.updateMany({ where: { status: 'running' }, data: { status: 'failed', error: 'Interrupted by a backend restart. Scan again.', finishedAt: new Date() } })
}

/** Starts scans in the background and returns the account ids that were started (already-running ones are skipped). */
export async function startScans(userId: string, accountIds?: string[]) {
  const accounts = await prisma.connectedAccount.findMany({ where: { userId, provider: 'google_drive', status: 'connected', ...(accountIds ? { id: { in: accountIds } } : {}) } })
  const started: string[] = []
  for (const account of accounts) {
    if (running.has(account.id)) continue
    running.add(account.id)
    started.push(account.id)
    void scanAccount(account.id, userId)
      .catch((error) => console.error('[scan] failed', account.id, error instanceof Error ? error.message : error))
      .finally(() => running.delete(account.id))
  }
  return started
}

async function scanAccount(accountId: string, userId: string) {
  const scanId = crypto.randomUUID()
  await prisma.driveScan.upsert({
    where: { connectedAccountId: accountId },
    create: { connectedAccountId: accountId, status: 'running', scanId, itemsFound: 0, startedAt: new Date() },
    update: { status: 'running', scanId, itemsFound: 0, error: null, startedAt: new Date(), finishedAt: null },
  })
  try {
    const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
    const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
    const rootId = (await withBackoff(() => drive.files.get({ fileId: 'root', fields: 'id' }))).data.id ?? 'root'

    const folders = new Map<string, FolderNode>()
    let pageToken: string | undefined
    do {
      const res = await withBackoff(() => drive.files.list({ q: `'me' in owners and mimeType = '${FOLDER_MIME}' and trashed = false`, fields: 'nextPageToken,files(id,name,parents)', pageSize: 1000, pageToken, spaces: 'drive' }))
      for (const f of res.data.files ?? []) if (f.id) folders.set(f.id, { name: f.name ?? '', parent: f.parents?.[0] ?? null })
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    let found = 0
    pageToken = undefined
    do {
      const res = await withBackoff(() => drive.files.list({ q: `'me' in owners and mimeType != '${FOLDER_MIME}' and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,parents,modifiedTime)', pageSize: 1000, pageToken, spaces: 'drive' }))
      const rows = (res.data.files ?? []).filter((f) => f.id && f.name).map((f) => ({
        id: crypto.randomUUID(),
        providerFileId: f.id!,
        name: f.name!.slice(0, 255),
        mimeType: (f.mimeType ?? 'application/octet-stream').slice(0, 191),
        sizeBytes: BigInt(f.size ?? 0),
        md5: f.md5Checksum ?? null,
        path: buildPath(f.parents?.[0], folders, rootId),
        modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null,
      }))
      for (let i = 0; i < rows.length; i += CHUNK) await upsertRows(userId, accountId, scanId, rows.slice(i, i + CHUNK))
      found += rows.length
      await prisma.driveScan.update({ where: { connectedAccountId: accountId }, data: { itemsFound: found } })
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    const removed = await prisma.driveItem.deleteMany({ where: { connectedAccountId: accountId, scanId: { not: scanId } } })
    await prisma.driveScan.update({ where: { connectedAccountId: accountId }, data: { status: 'done', itemsFound: found, finishedAt: new Date() } })
    console.info('[scan] done', { accountId, found, removed: removed.count })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.driveScan.update({ where: { connectedAccountId: accountId }, data: { status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() } }).catch(() => undefined)
    throw error
  }
}

type Row = { id: string; providerFileId: string; name: string; mimeType: string; sizeBytes: bigint; md5: string | null; path: string; modifiedAt: Date | null }

async function upsertRows(userId: string, accountId: string, scanId: string, rows: Row[]) {
  if (rows.length === 0) return
  const values = rows.map((r) => Prisma.sql`(${r.id}, ${userId}, ${accountId}, ${r.providerFileId}, ${r.name}, ${r.mimeType}, ${r.sizeBytes}, ${r.md5}, ${r.path}, ${r.modifiedAt}, ${scanId}, NOW(3), NOW(3))`)
  await prisma.$executeRaw`
    INSERT INTO drive_items (id, user_id, connected_account_id, provider_file_id, name, mime_type, size_bytes, md5, path, modified_at, scan_id, created_at, updated_at)
    VALUES ${Prisma.join(values)}
    ON DUPLICATE KEY UPDATE name = VALUES(name), mime_type = VALUES(mime_type), size_bytes = VALUES(size_bytes), md5 = VALUES(md5), path = VALUES(path), modified_at = VALUES(modified_at), scan_id = VALUES(scan_id), updated_at = NOW(3)`
}
