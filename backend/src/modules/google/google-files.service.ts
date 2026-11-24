import { google, type drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient } from './google.service.js'

export const googleFolderMime = 'application/vnd.google-apps.folder'
const fields = 'id,name,mimeType,size,modifiedTime,parents,webViewLink,shared,ownedByMe,trashed,capabilities(canRename,canTrash)'

export function googleFilesQuery(parentId?: string, search?: string) {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const parent = parentId || (search ? undefined : 'root')
  return ['trashed = false', "'me' in owners", parent ? `'${escape(parent)}' in parents` : '', search ? `name contains '${escape(search)}'` : ''].filter(Boolean).join(' and ')
}

async function accountFor(userId: string, accountId: string) {
  return prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
}

export async function listGoogleFilesPage(userId: string, accountId: string, query: { parentId?: string; q?: string; pageToken?: string }) {
  const account = await accountFor(userId, accountId)
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const q = query.parentId ? googleFilesQuery(query.parentId) : (query.q ? googleFilesQuery(undefined, query.q) : googleFilesQuery())
  const result = await drive.files.list({ q, fields: `nextPageToken,files(${fields})`, pageSize: 100, pageToken: query.pageToken, orderBy: 'folder,name' })
  return { files: result.data.files ?? [], nextPageToken: result.data.nextPageToken ?? null }
}

export async function createGoogleFolder(userId: string, accountId: string, name: string, parentId?: string) {
  const account = await accountFor(userId, accountId)
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const folder = await drive.files.create({ requestBody: { name, mimeType: googleFolderMime, parents: parentId ? [parentId] : undefined }, fields: 'id,name,mimeType' })
  return folder.data
}

export async function changeGoogleFile(userId: string, accountId: string, fileId: string, body: { name?: string; trashed?: boolean }) {
  const account = await accountFor(userId, accountId)
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const updated = await drive.files.update({ fileId, requestBody: body, fields })
  return updated.data
}