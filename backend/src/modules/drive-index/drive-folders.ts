import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { withBackoff } from '../google/backoff.js'
import { FOLDER_MIME } from '../jobs/move-logic.js'
import { retryOnLock } from './drive-scan.js'

/*
 * Browser paths ("My Drive/Photos/2024") are how the drive browser names folders. These helpers turn a path into the
 * real Google Drive folder id (from the drive_folders index first, then by asking Drive folder by folder), create
 * missing folders, and keep drive_items / drive_folders paths right after a rename.
 */

export const ROOT_PATH = 'My Drive'
export const APP_FOLDER_PATH = 'My Drive/9drive'

export class PathError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_PATH') { super(message) }
}

const escapeQ = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

/** A file or folder name the browser can show: the path model uses "/" as separator, so names can't contain it. */
export function cleanName(raw: string) {
  const name = raw.trim()
  if (!name) throw new PathError('Enter a name.', 400, 'INVALID_NAME')
  if (name.length > 255) throw new PathError('That name is too long (255 characters max).', 400, 'INVALID_NAME')
  if (name.includes('/')) throw new PathError('Names cannot contain "/".', 400, 'INVALID_NAME')
  if (name === '.' || name === '..') throw new PathError('That name is not allowed.', 400, 'INVALID_NAME')
  return name
}

/** Normalises a browser path and checks it points inside My Drive (not a shared folder we can't write to). */
export function cleanPath(raw: string) {
  const path = raw.replace(/\/+$/, '').replace(/\/{2,}/g, '/') || ROOT_PATH
  if (path !== ROOT_PATH && !path.startsWith(`${ROOT_PATH}/`)) throw new PathError('That folder is not in My Drive.')
  const segments = path.split('/').slice(1)
  if (segments.some((s) => !s.trim() || s === '(shared folder)')) throw new PathError('That folder is shared with you, so it cannot be changed here.', 403)
  if (path.length > 1000) throw new PathError('That folder path is too long.')
  return path
}

export const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || ROOT_PATH
export const isAppFolder = (path: string) => path.toLowerCase() === APP_FOLDER_PATH.toLowerCase()

export async function findChildFolder(drive: drive_v3.Drive, parentId: string, name: string) {
  const res = await withBackoff(() => drive.files.list({ q: `'${parentId}' in parents and name = '${escapeQ(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false and 'me' in owners`, fields: 'files(id,name)', pageSize: 10, spaces: 'drive' }))
  // Drive name matching ignores case; prefer an exact match.
  const files = res.data.files ?? []
  return (files.find((f) => f.name === name) ?? files[0])?.id ?? null
}

export async function rememberFolder(userId: string, accountId: string, providerFolderId: string, path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1).slice(0, 255)
  await retryOnLock(() => prisma.driveFolder.upsert({
    where: { connectedAccountId_providerFolderId: { connectedAccountId: accountId, providerFolderId } },
    create: { userId, connectedAccountId: accountId, providerFolderId, name, path, scanId: crypto.randomUUID() },
    update: { name, path },
  }))
}

/** The Drive folder id for a browser path, or null when that folder does not exist on this drive. */
export async function resolvePath(drive: drive_v3.Drive, userId: string, accountId: string, path: string): Promise<string | null> {
  if (path === ROOT_PATH) return 'root'
  const known = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT provider_folder_id AS id FROM drive_folders WHERE connected_account_id = ${accountId} AND path COLLATE utf8mb4_bin = ${path} LIMIT 1`
  if (known[0]) {
    // The index can be stale (folder trashed or moved in Drive since the last scan); check before trusting it.
    try {
      const meta = (await withBackoff(() => drive.files.get({ fileId: known[0].id, fields: 'id,trashed,mimeType' }))).data
      if (meta.id && !meta.trashed && meta.mimeType === FOLDER_MIME) return meta.id
    } catch { /* fall through to a fresh lookup */ }
  }
  let current = 'root'
  let soFar = ROOT_PATH
  for (const name of path.split('/').slice(1)) {
    const id = await findChildFolder(drive, current, name)
    if (!id) return null
    current = id
    soFar = `${soFar}/${name}`
    await rememberFolder(userId, accountId, id, soFar).catch(() => undefined)
  }
  return current
}

// Several files of one folder upload can ask for the same missing folder at once; create it only once.
const inFlight = new Map<string, Promise<string>>()

/** Like resolvePath, but creates any missing folders on the way. */
export async function ensurePath(drive: drive_v3.Drive, userId: string, accountId: string, path: string): Promise<string> {
  const existing = await resolvePath(drive, userId, accountId, path)
  if (existing) return existing
  const key = `${accountId}|${path.toLowerCase()}`
  let pending = inFlight.get(key)
  if (!pending) {
    pending = (async () => {
      const parentId = path === ROOT_PATH ? 'root' : await ensurePath(drive, userId, accountId, parentOf(path))
      const name = path.slice(path.lastIndexOf('/') + 1)
      const id = (await findChildFolder(drive, parentId, name)) ?? (await withBackoff(() => drive.files.create({ requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] }, fields: 'id' }))).data.id
      if (!id) throw new PathError('Google Drive did not create the folder.', 502, 'FOLDER_CREATE_FAILED')
      await rememberFolder(userId, accountId, id, path)
      return id
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
  }
  return pending
}

/** Rewrites the stored paths of everything at or below `from` on one drive after a folder rename. */
export async function rewritePaths(accountId: string, from: string, to: string) {
  const prefix = `${likeEscape(from)}/%`
  for (const table of ['drive_items', 'drive_folders'] as const) {
    await retryOnLock(() => prisma.$executeRaw`
      UPDATE ${Prisma.raw(table)}
      SET path = LEFT(CONCAT(${to}, SUBSTRING(path, CHAR_LENGTH(${from}) + 1)), 1024), updated_at = NOW(3)
      WHERE connected_account_id = ${accountId} AND (path COLLATE utf8mb4_bin = ${from} OR path COLLATE utf8mb4_bin LIKE ${prefix})`)
  }
}
