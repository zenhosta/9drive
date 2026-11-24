import { randomUUID } from 'node:crypto'
import { google, type drive_v3 } from 'googleapis'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { getAuthedGoogleClient, ensureGoogleAppFolder, syncGoogleQuota } from '../google/google.service.js'
import { planBalance, selectBalanceMoves, verifyCopy, type BalanceAccount, type Candidate, type Move } from './planner.js'

type Plan = { deleteOriginals?: boolean; scope: 'managed' | 'all'; accounts: BalanceAccount[]; projected: BalanceAccount[]; moves: Move[]; scanned: number; skipped: number; limited: boolean }
const fields = 'id,name,mimeType,size,md5Checksum,modifiedTime,trashed,ownedByMe,shared,capabilities(canDownload,canTrash),appProperties'
const running = new Set<string>()
const json = (plan: Plan) => JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue

function safeError(error: unknown) {
  if (error instanceof Error && error.name === 'BalanceError') return error.message
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status === 401) return 'A conta Google precisa ser reconectada.'
  if (status === 403) return 'O Google recusou a operação. Confira permissões, API do Drive e espaço disponível.'
  if (status === 404) return 'Arquivo ou conta não encontrado. O original não foi excluído definitivamente.'
  return 'A transferência foi interrompida. As cópias existentes foram preservadas; tente retomar ou confira as contas.'
}
function fail(message: string): never { const error = new Error(message); error.name = 'BalanceError'; throw error }
function assertOriginal(move: Move, file: drive_v3.Schema$File) {
  if (file.trashed || !file.ownedByMe || file.shared || !file.capabilities?.canTrash || !file.capabilities?.canDownload || file.md5Checksum !== move.md5 || file.size !== move.sizeBytes || file.modifiedTime !== move.modifiedTime) {
    fail('O original mudou desde a prévia, está compartilhado ou não pode ser transferido. Ele foi preservado. Gere uma nova prévia.')
  }
}

export async function previewBalance(userId: string, scope: Plan['scope']) {
  const current = await prisma.storageRebalanceJob.findUnique({ where: { userId } })
  if (current?.status === 'running') fail('Pause a redistribuição atual antes de gerar outra prévia.')
  if (current && ['paused', 'failed'].includes(current.status) && (current.plan as unknown as Plan).moves.some(m => m.targetFileId || m.status === 'copying')) {
    fail('Retome a redistribuição anterior antes de gerar outra prévia. Pode haver cópias já criadas.')
  }
  const connected = await prisma.connectedAccount.findMany({ where: { userId, provider: 'google_drive', status: 'connected' }, orderBy: { createdAt: 'asc' } })
  if (connected.length < 2) fail('Conecte pelo menos duas contas Google Drive.')
  if (connected.length > 20) fail('Esta versão permite equilibrar até 20 contas por usuário.')
  const accounts: BalanceAccount[] = []
  const candidates: Candidate[] = []
  let scanned = 0, skipped = 0, limited = false
  for (const account of connected) {
    const quota = await syncGoogleQuota(account.id)
    if (quota.totalBytes === null || quota.availableBytes === null) continue
    accounts.push({ id: account.id, label: account.email, usedBytes: (quota.usedBytes - (quota.trashBytes ?? 0n)).toString(), freeBytes: (quota.availableBytes > 0n ? quota.availableBytes : 0n).toString() })
    const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
    let query = "'me' in owners and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
    if (scope === 'managed') {
      const roots = await drive.files.list({ q: "name = '9drive' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false", fields: 'files(id)', pageSize: 100 })
      const folders = await prisma.folder.findMany({ where: { userId, connectedAccountId: account.id, deletedAt: null, providerFolderId: { not: null } }, select: { providerFolderId: true } })
      const ids = [...roots.data.files?.map(f => f.id).filter(Boolean) ?? [], ...folders.map(f => f.providerFolderId).filter(Boolean)]
      if (!ids.length) continue
      query += ` and (${ids.map(id => `'${id!.replace(/'/g, "\\'")}' in parents`).join(' or ')})`
    }
    let pageToken: string | undefined, count = 0
    do {
      const result = await drive.files.list({ q: query, fields: `nextPageToken,files(${fields})`, pageSize: 100, pageToken, orderBy: 'quotaBytesUsed desc' })
      for (const file of result.data.files ?? []) {
        count++; scanned++
        if (!file.id || !file.name || !file.size || !file.md5Checksum || !file.modifiedTime || !file.mimeType || file.mimeType.startsWith('application/vnd.google-apps.') || !file.ownedByMe || file.shared || !file.capabilities?.canDownload || !file.capabilities?.canTrash) { skipped++; continue }
        candidates.push({ sourceAccountId: account.id, sourceFileId: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.size, md5: file.md5Checksum, modifiedTime: file.modifiedTime })
      }
      pageToken = result.data.nextPageToken ?? undefined
      if (count >= 1000 && pageToken) { limited = true; break }
    } while (pageToken)
  }
  if (accounts.length < 2) fail('São necessárias duas contas com limites de armazenamento conhecidos.')
  const balanced = planBalance(accounts, candidates)
  const plan: Plan = { scope, accounts, projected: balanced.projected, moves: balanced.moves.map(m => ({ ...m, id: randomUUID() })), scanned, skipped, limited: limited || balanced.moves.length === 100 }
  const id = randomUUID()
  if (current) {
    const result = await prisma.storageRebalanceJob.updateMany({ where: { id: current.id, userId, status: { not: 'running' }, updatedAt: current.updatedAt }, data: { id, status: 'draft', plan: json(plan), pauseRequested: false, createdAt: new Date() } })
    if (!result.count) fail('A redistribuição mudou enquanto a prévia era gerada. Atualize a página.')
  } else {
    await prisma.storageRebalanceJob.create({ data: { id, userId, plan: json(plan) } })
  }
  return getBalance(userId)
}

export async function getBalance(userId: string) {
  const job = await prisma.storageRebalanceJob.findUnique({ where: { userId } })
  return job ? { id: job.id, status: job.status, createdAt: job.createdAt, plan: job.plan as unknown as Plan } : null
}

export async function transferBalanceFile(userId: string, jobId: string, move: Move, save: () => Promise<void>) {
  const source = await prisma.connectedAccount.findFirstOrThrow({ where: { id: move.sourceAccountId, userId, provider: 'google_drive', status: 'connected' } })
  const target = await prisma.connectedAccount.findFirstOrThrow({ where: { id: move.targetAccountId, userId, provider: 'google_drive', status: 'connected' } })
  const sourceDrive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(source) })
  const targetDrive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(target) })
  const original = (await sourceDrive.files.get({ fileId: move.sourceFileId, fields })).data
  if (!move.targetFileId) {
    const found = await targetDrive.files.list({ q: `trashed = false and appProperties has { key='9driveRebalance' and value='${move.id}' }`, fields: 'files(id)', pageSize: 100 })
    if ((found.data.files?.length ?? 0) > 1) fail('Há mais de uma cópia para esta transferência. Confira o destino antes de continuar.')
    move.targetFileId = found.data.files?.[0]?.id ?? undefined
    if (move.targetFileId) await save()
  }
  if (!move.targetFileId) {
    assertOriginal(move, original)
    const quota = await syncGoogleQuota(target.id)
    if (quota.availableBytes === null || quota.availableBytes < BigInt(move.sizeBytes)) fail('O destino não tem espaço suficiente. O original foi preservado.')
    const parent = await ensureGoogleAppFolder(target)
    const download = await sourceDrive.files.get({ fileId: move.sourceFileId, alt: 'media' }, { responseType: 'stream' })
    try {
      const copy = await targetDrive.files.create({ requestBody: { name: move.name, mimeType: move.mimeType, parents: [parent], appProperties: { '9driveRebalance': move.id, '9driveRebalanceJob': jobId } }, media: { mimeType: move.mimeType, body: download.data }, fields: 'id' }, { retry: false })
      if (!copy.data.id) fail('O Google não retornou o identificador da cópia. O original foi preservado.')
      move.targetFileId = copy.data.id!
      await save()
    } finally {
      download.data.destroy()
    }
  }
  const copied = (await targetDrive.files.get({ fileId: move.targetFileId, fields: 'id,size,md5Checksum,trashed' })).data
  try { verifyCopy(move, copied) } catch { fail('A cópia não passou na verificação de tamanho e checksum. O original foi preservado.') }
  if (!original.trashed) assertOriginal(move, (await sourceDrive.files.get({ fileId: move.sourceFileId, fields })).data)
  const existing = await prisma.file.findFirst({ where: { userId, provider: 'google_drive', OR: [{ providerFileId: move.sourceFileId, connectedAccountId: source.id }, { providerFileId: move.targetFileId, connectedAccountId: target.id }] } })
  if (original.trashed && (!existing || existing.providerFileId !== move.targetFileId)) fail('O original está na lixeira e o registro do destino não foi confirmado. Confira as duas contas.')
  if (existing && existing.providerFileId === move.sourceFileId) {
    const changed = await prisma.file.updateMany({ where: { id: existing.id, userId, connectedAccountId: source.id, providerFileId: move.sourceFileId, status: 'active', updatedAt: existing.updatedAt }, data: { connectedAccountId: target.id, providerFileId: move.targetFileId, checksum: move.md5 } })
    if (!changed.count) fail('O arquivo foi alterado no 9Drive durante a transferência. As cópias foram preservadas.')
  } else if (!existing) {
    await prisma.file.create({ data: { userId, provider: 'google_drive', connectedAccountId: target.id, providerFileId: move.targetFileId, name: move.name, mimeType: move.mimeType, sizeBytes: BigInt(move.sizeBytes), checksum: move.md5 } })
  }
  if (!original.trashed) {
    assertOriginal(move, (await sourceDrive.files.get({ fileId: move.sourceFileId, fields })).data)
    try { verifyCopy(move, (await targetDrive.files.get({ fileId: move.targetFileId, fields: 'size,md5Checksum,trashed' })).data) } catch { fail('A cópia no destino mudou antes de finalizar. O original foi preservado.') }
    await sourceDrive.files.update({ fileId: move.sourceFileId, requestBody: { trashed: true }, fields: 'id,trashed' })
  }
  move.status = 'completed'
  delete move.error
  await save()
  await Promise.allSettled([syncGoogleQuota(source.id), syncGoogleQuota(target.id)])
}

export async function purgeBalanceOriginal(userId: string, move: Move, save: () => Promise<void>) {
  if (move.originalDeleted) return
  if (move.status !== 'completed' || !move.targetFileId) fail('A transferência ainda não foi concluída. O original foi preservado.')
  const source = await prisma.connectedAccount.findFirstOrThrow({ where: { id: move.sourceAccountId, userId, provider: 'google_drive', status: 'connected' } })
  const target = await prisma.connectedAccount.findFirstOrThrow({ where: { id: move.targetAccountId, userId, provider: 'google_drive', status: 'connected' } })
  const sourceDrive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(source) })
  const targetDrive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(target) })
  const verifyDestination = async () => {
    try { verifyCopy(move, (await targetDrive.files.get({ fileId: move.targetFileId!, fields: 'size,md5Checksum,trashed' })).data) }
    catch { fail('A cópia no destino não pôde ser verificada. O original não foi excluído permanentemente.') }
    const record = await prisma.file.findFirst({ where: { userId, connectedAccountId: target.id, providerFileId: move.targetFileId, provider: 'google_drive', status: 'active' } })
    if (!record) fail('O registro da cópia no destino não foi confirmado. O original foi preservado.')
  }
  await verifyDestination()
  let original: drive_v3.Schema$File | undefined
  try { original = (await sourceDrive.files.get({ fileId: move.sourceFileId, fields: 'id,size,md5Checksum,modifiedTime,trashed,ownedByMe,shared,capabilities(canDelete)' })).data }
  catch (error) { if ((error as { response?: { status?: number } })?.response?.status !== 404) throw error }
  if (original) {
    if (!original.trashed || !original.ownedByMe || original.shared || !original.capabilities?.canDelete || original.size !== move.sizeBytes || original.md5Checksum !== move.md5) fail('O original mudou ou saiu da lixeira. A exclusão automática foi interrompida.')
    await verifyDestination()
    await sourceDrive.files.delete({ fileId: move.sourceFileId }, { retry: false })
  }
  move.originalDeleted = true
  delete move.error
  await save()
  await syncGoogleQuota(source.id).catch(() => undefined)
}

async function work(userId: string, jobId: string) {
  if (running.has(userId)) return
  running.add(userId)
  try {
    const job = await prisma.storageRebalanceJob.findFirstOrThrow({ where: { id: jobId, userId, status: 'running' } })
    const plan = job.plan as unknown as Plan
    const save = async () => { await prisma.storageRebalanceJob.update({ where: { id: jobId }, data: { plan: json(plan) } }) }
    for (const move of plan.moves) {
      if (move.status === 'completed' && (!plan.deleteOriginals || move.originalDeleted)) continue
      const state = await prisma.storageRebalanceJob.findUniqueOrThrow({ where: { id: jobId } })
      if (state.pauseRequested) { await prisma.storageRebalanceJob.update({ where: { id: jobId }, data: { status: 'paused' } }); return }
      try {
        if (move.status !== 'completed') { move.status = 'copying'; delete move.error; await save(); await transferBalanceFile(userId, jobId, move, save) }
        if (plan.deleteOriginals) await purgeBalanceOriginal(userId, move, save)
      } catch (error) {
        if (move.status !== 'completed') move.status = 'failed'
        move.error = safeError(error); await save()
        await prisma.storageRebalanceJob.update({ where: { id: jobId }, data: { status: 'failed' } })
        return
      }
    }
    await prisma.storageRebalanceJob.update({ where: { id: jobId }, data: { status: 'completed' } })
  } catch {
    console.error('Rebalance worker interrupted; plan and original files retained.', { jobId })
    await prisma.storageRebalanceJob.updateMany({ where: { id: jobId, userId, status: 'running' }, data: { status: 'paused' } }).catch(() => undefined)
  } finally { running.delete(userId) }
}

export async function startBalance(userId: string, jobId: string, selectedMoveIds?: string[], deleteOriginals?: boolean) {
  const job = await prisma.storageRebalanceJob.findFirstOrThrow({ where: { id: jobId, userId } })
  if (job.status === 'draft' && Date.now() - job.createdAt.getTime() > 30 * 60_000) fail('A prévia expirou. Gere uma nova prévia para conferir espaço e arquivos atuais.')
  let plan = job.plan as unknown as Plan
  if (job.status === 'draft') {
    if (!selectedMoveIds) fail('Atualize a página e selecione os arquivos que deseja redistribuir.')
    plan = { ...plan, deleteOriginals: deleteOriginals === true, ...selectBalanceMoves(plan.accounts, plan.moves, selectedMoveIds) }
  } else if (selectedMoveIds !== undefined || deleteOriginals !== undefined) {
    fail('A seleção não pode mudar depois que a redistribuição começou.')
  }
  const changed = await prisma.storageRebalanceJob.updateMany({ where: { id: jobId, userId, updatedAt: job.updatedAt, status: { in: ['draft', 'paused', 'failed'] } }, data: { plan: json(plan), status: 'running', pauseRequested: false } })
  if (!changed.count) fail('Esta redistribuição já está em andamento ou terminou.')
  void work(userId, jobId)
  return getBalance(userId)
}

export async function pauseBalance(userId: string, jobId: string) {
  await prisma.storageRebalanceJob.updateMany({ where: { id: jobId, userId, status: 'running' }, data: { pauseRequested: true } })
  return getBalance(userId)
}

export async function endBalance(userId: string, jobId: string) {
  const changed = await prisma.storageRebalanceJob.updateMany({ where: { id: jobId, userId, status: { in: ['draft', 'paused', 'failed'] } }, data: { status: 'cancelled' } })
  if (!changed.count) fail('Pause o trabalho e aguarde o arquivo atual terminar antes de encerrar.')
  return getBalance(userId)
}

export async function recoverBalanceJobs() {
  await prisma.storageRebalanceJob.updateMany({ where: { status: 'running' }, data: { status: 'paused' } })
}