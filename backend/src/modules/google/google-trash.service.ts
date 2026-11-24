import { google, type drive_v3 } from 'googleapis'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, syncGoogleQuota } from './google.service.js'
import { createAuditLog } from '../../utils/audit.js'

const fields = 'id,name,mimeType,size,quotaBytesUsed,trashed,explicitlyTrashed,trashedTime,ownedByMe,capabilities(canDelete,canUntrash)'

function fail(message: string): never { const error = new Error(message); error.name = 'TrashError'; throw error }

export function assertTrashAction(file: drive_v3.Schema$File, action: 'restore' | 'delete') {
  if (!file.trashed || !file.ownedByMe) fail('Este item não está mais na lixeira desta conta ou não pertence a ela. Atualize a lista.')
  if (action === 'restore' && (!file.explicitlyTrashed || !file.capabilities?.canUntrash)) fail('Restaure primeiro a pasta que contém este item, ou confira as permissões no Google Drive.')
  if (action === 'delete' && !file.capabilities?.canDelete) fail('O Google Drive não permite excluir este item definitivamente.')
}

async function accountFor(userId: string, accountId: string) {
  return prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
}

export async function listGoogleTrash(userId: string) {
  const accounts = await prisma.connectedAccount.findMany({ where: { userId, provider: 'google_drive', status: 'connected' } })
  return Promise.all(accounts.map(async (account) => {
    const auth = await getAuthedGoogleClient(account)
    const drive = google.drive({ version: 'v3', auth })
    const result = await drive.files.list({ q: "trashed = true and 'me' in owners", fields: 'files(id)', pageSize: 1 })
    const count = result.data.files?.length ?? 0
    return { accountId: account.id, accountEmail: account.email, trashedCount: count }
  }))
}

export async function listGoogleTrashPage(userId: string, accountId: string, pageToken?: string) {
  const account = await accountFor(userId, accountId)
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const result = await drive.files.list({ q: "trashed = true and 'me' in owners", fields: `nextPageToken,files(${fields})`, pageSize: 100, pageToken, orderBy: 'trashedTime desc' })
  return { files: result.data.files ?? [], nextPageToken: result.data.nextPageToken ?? null }
}

export async function changeGoogleTrash(userId: string, accountId: string, fileId: string, action: 'restore' | 'delete') {
  const account = await accountFor(userId, accountId)
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const file = (await drive.files.get({ fileId, fields })).data
  assertTrashAction(file, action)
  if (action === 'restore') {
    await drive.files.update({ fileId, requestBody: { trashed: false }, fields: 'id,trashed' })
    await syncGoogleQuota(accountId)
    await createAuditLog(userId, 'trash_restore', 'file', fileId, { accountId, name: file.name })
    return { restored: true }
  } else {
    await drive.files.delete({ fileId })
    await syncGoogleQuota(accountId)
    await createAuditLog(userId, 'trash_delete', 'file', fileId, { accountId, name: file.name })
    return { deleted: true }
  }
}