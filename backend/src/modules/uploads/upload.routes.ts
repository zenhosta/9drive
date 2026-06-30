import Busboy from 'busboy'
import type { NextFunction, Response } from 'express'
import { Router } from 'express'
import { Readable } from 'stream'
import { google } from 'googleapis'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, syncGoogleQuota } from '../google/google.service.js'
import { buildS3ObjectKey, getS3ConfigForAccount, syncS3Quota, uploadS3Object } from '../s3/s3.service.js'

export const uploadRouter = Router()

type UploadMeta = { fieldName: string; fileName: string; mimeType: string; sizeBytes: bigint; folderId?: string }
type RoutingMode = 'most_available' | 'round_robin' | 'priority'

function logUpload(message: string, metadata?: Record<string, unknown>) {
  console.info('[upload]', message, metadata ?? '')
}

function syncQuotaInBackground(accountId: string, sessionId: string) {
  logUpload('quota sync started', { accountId, sessionId })
  syncGoogleQuota(accountId)
    .then(() => logUpload('quota sync completed', { accountId, sessionId }))
    .catch((error) => logUpload('quota sync failed', { accountId, sessionId, message: error instanceof Error ? error.message : 'Unknown error' }))
}

function normalizePriorityAccountIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function byPriority<T extends { account: { id: string; createdAt: Date } }>(items: T[], priorityAccountIds: string[]) {
  const order = new Map(priorityAccountIds.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const aOrder = order.get(a.account.id)
    const bOrder = order.get(b.account.id)
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
    if (aOrder !== undefined) return -1
    if (bOrder !== undefined) return 1
    return a.account.createdAt.getTime() - b.account.createdAt.getTime()
  })
}

async function selectAccount(userId: string, sizeBytes: bigint, reservedBytesByAccount = new Map<string, bigint>()) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, provider: { in: ['google_drive', 's3'] }, status: 'connected' },
    include: { storageAccount: true },
  })

  const stale = accounts.filter((account) => !account.storageAccount?.lastSyncedAt || account.storageAccount.lastSyncedAt.getTime() < Date.now() - 5 * 60_000)
  for (const account of stale) {
    if (account.provider === 's3') await syncS3Quota(account.id)
    else await syncGoogleQuota(account.id)
  }

  const fresh = await prisma.connectedAccount.findMany({
    where: { userId, provider: { in: ['google_drive', 's3'] }, status: 'connected' },
    include: { storageAccount: true },
  })

  const eligible = fresh
    .map((account) => ({ account, availableBytes: account.storageAccount?.availableBytes === null || account.storageAccount?.availableBytes === undefined ? null : account.storageAccount.availableBytes - (reservedBytesByAccount.get(account.id) ?? 0n) }))
    .filter(({ availableBytes }) => availableBytes === null || availableBytes >= sizeBytes)

  if (eligible.length === 0) return null

  const policy = await prisma.uploadRoutingPolicy.upsert({ where: { userId }, create: { userId, mode: 'most_available', priorityAccountIds: [] }, update: {} })
  const mode = (['most_available', 'round_robin', 'priority'].includes(policy.mode) ? policy.mode : 'most_available') as RoutingMode
  const priorityAccountIds = normalizePriorityAccountIds(policy.priorityAccountIds)

  if (mode === 'priority') return byPriority(eligible, priorityAccountIds)[0]?.account ?? null

  if (mode === 'round_robin') {
    const ordered = byPriority(eligible, priorityAccountIds)
    const selected = ordered[policy.roundRobinCursor % ordered.length]?.account ?? ordered[0]?.account ?? null
    await prisma.uploadRoutingPolicy.update({ where: { userId }, data: { roundRobinCursor: policy.roundRobinCursor + 1 } })
    return selected
  }

  return eligible
    .sort((a, b) => {
      if (a.availableBytes === null && b.availableBytes === null) return a.account.provider === 's3' ? -1 : 1
      if (a.availableBytes === null) return a.account.provider === 's3' ? -1 : 1
      if (b.availableBytes === null) return b.account.provider === 's3' ? 1 : -1
      return Number(b.availableBytes - a.availableBytes)
    })[0]?.account
}

export async function handleUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    logUpload('request started', { userId: req.user!.id, contentLength: req.headers['content-length'] })
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) return res.status(400).json({ code: 'UPLOAD_INVALID_CONTENT_TYPE', message: 'multipart/form-data required.' })

    const busboy = Busboy({ headers: req.headers, limits: { files: 25, fileSize: env.MAX_UPLOAD_BYTES } })
    const fields: { sizeBytes?: bigint; fileName?: string; mimeType?: string; folderId?: string } = {}
    let batchMeta: UploadMeta[] | null = null
    let responded = false
    let fileSeen = false
    const reservedBytesByAccount = new Map<string, bigint>()
    const completed: Array<Record<string, unknown>> = []
    const failed: Array<{ fileName: string; code: string; message: string }> = []
    const pendingUploads: Array<Promise<void>> = []

    const fail = async (status: number, code: string, message: string) => {
      if (responded) return
      responded = true
      req.unpipe(busboy)
      req.resume()
      return res.status(status).json({ code, message })
    }

    const parseBatchMeta = (value: string) => JSON.parse(value).map((item: { fieldName: string; fileName: string; mimeType: string; sizeBytes: string | number; folderId?: string }) => ({
      fieldName: item.fieldName,
      fileName: item.fileName,
      mimeType: item.mimeType,
      sizeBytes: BigInt(item.sizeBytes),
      folderId: item.folderId,
    })) as UploadMeta[]

    const metaForFile = (fieldName: string, info: { filename: string; mimeType: string }) => {
      if (batchMeta) return batchMeta.find((item) => item.fieldName === fieldName)
      const sizeBytes = fields.sizeBytes
      if (!sizeBytes) return null
      return { fieldName, sizeBytes, fileName: fields.fileName || info.filename, mimeType: fields.mimeType || info.mimeType || 'application/octet-stream', folderId: fields.folderId }
    }

    const uploadOne = async (fieldName: string, fileStream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      const meta = metaForFile(fieldName, info)
      const fileName = meta?.fileName || info.filename
      try {
        fileStream.on('limit', () => logUpload('file stream size limit reached', { fileName }))
        if (!meta?.sizeBytes || meta.sizeBytes <= 0n) {
          fileStream.resume()
          failed.push({ fileName, code: 'UPLOAD_SIZE_REQUIRED', message: 'sizeBytes field must be sent before file field.' })
          return
        }
        if (meta.sizeBytes > BigInt(env.MAX_UPLOAD_BYTES)) {
          fileStream.resume()
          failed.push({ fileName, code: 'UPLOAD_TOO_LARGE', message: 'File exceeds max upload size.' })
          return
        }

        const account = await selectAccount(req.user!.id, meta.sizeBytes, reservedBytesByAccount)
        if (!account) {
          fileStream.resume()
          failed.push({ fileName, code: 'NO_ACCOUNT_WITH_ENOUGH_SPACE', message: 'No connected storage account has enough space for this upload.' })
          return
        }
        reservedBytesByAccount.set(account.id, (reservedBytesByAccount.get(account.id) ?? 0n) + meta.sizeBytes)

        const folderId = meta.folderId || null
        if (folderId) await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId: req.user!.id, deletedAt: null } })

        const session = await prisma.uploadSession.create({ data: { userId: req.user!.id, targetConnectedAccountId: account.id, fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, status: 'uploading' } })
        logUpload('file upload started', { sessionId: session.id, accountId: account.id, fileName, sizeBytes: meta.sizeBytes.toString() })
        const chunks: Buffer[] = []
        fileStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        await new Promise<void>((resolve, reject) => {
          fileStream.on('end', resolve)
          fileStream.on('error', reject)
        })
        const fileBuffer = Buffer.concat(chunks)
        const streamedBytes = BigInt(fileBuffer.length)

        let providerFileId = ''
        let s3FileId: string | null = null
        let uploadedName = fileName
        let uploadedMimeType = meta.mimeType
        if (account.provider === 's3') {
          const config = await getS3ConfigForAccount(account.id, req.user!.id)
          const provisionalFile = await prisma.file.create({
            data: { userId: req.user!.id, connectedAccountId: account.id, folderId, provider: 's3', providerFileId: 'pending', name: fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, status: 'uploading' },
          })
          s3FileId = provisionalFile.id
          providerFileId = buildS3ObjectKey(config, req.user!.id, provisionalFile.id, fileName)
          await uploadS3Object(config, providerFileId, fileStream, meta.mimeType)
          await prisma.file.update({ where: { id: provisionalFile.id }, data: { providerFileId, status: 'active' } })
          completed.push({ ...provisionalFile, providerFileId, status: 'active', sizeBytes: provisionalFile.sizeBytes.toString() })
          logUpload('s3 upload completed', { sessionId: session.id, accountId: account.id, fileName })
        } else {
          const auth = await getAuthedGoogleClient(account)
          const drive = google.drive({ version: 'v3', auth })
          const appFolderId = await ensureGoogleAppFolder(account)
          const uploaded = await drive.files.create({
            requestBody: { name: fileName, parents: [appFolderId] },
            media: { mimeType: meta.mimeType, body: Readable.from(fileBuffer) },
            fields: 'id,name,mimeType,size',
          })
          providerFileId = uploaded.data.id ?? ''
          uploadedName = uploaded.data.name ?? fileName
          uploadedMimeType = uploaded.data.mimeType ?? meta.mimeType
          logUpload('google upload completed', { sessionId: session.id, accountId: account.id, fileName })
        }

        if (streamedBytes !== meta.sizeBytes) {
          if (s3FileId) await prisma.file.update({ where: { id: s3FileId }, data: { status: 'deleted', deletedAt: new Date() } }).catch(() => undefined)
          await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'failed', errorMessage: 'Streamed byte count did not match declared size.' } })
          failed.push({ fileName, code: 'UPLOAD_SIZE_MISMATCH', message: 'Streamed byte count did not match declared size.' })
          return
        }

        const file = account.provider === 's3' ? null : await prisma.file.create({ data: { userId: req.user!.id, connectedAccountId: account.id, folderId, provider: 'google_drive', providerFileId, name: uploadedName, mimeType: uploadedMimeType, sizeBytes: meta.sizeBytes } })
        if (file) {
          logUpload('database file created', { sessionId: session.id, fileId: file.id, accountId: account.id })
          completed.push({ ...file, sizeBytes: file.sizeBytes.toString() })
        }
        await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'completed', completedAt: new Date() } })
        if (account.provider === 's3') syncS3Quota(account.id).catch(() => undefined)
        else syncQuotaInBackground(account.id, session.id)
      } catch (error) {
        fileStream.resume()
        logUpload('file upload failed', { fileName, message: error instanceof Error ? error.message : 'Upload failed' })
        failed.push({ fileName, code: 'UPLOAD_FAILED', message: error instanceof Error ? error.message : 'Upload failed' })
      }
    }

    busboy.on('field', (name, value) => {
      if (name === 'sizeBytes') fields.sizeBytes = BigInt(value)
      if (name === 'fileName') fields.fileName = value
      if (name === 'mimeType') fields.mimeType = value
      if (name === 'folderId') fields.folderId = value
      if (name === 'filesMeta') batchMeta = parseBatchMeta(value)
    })

    busboy.on('file', (name, fileStream, info) => {
      fileSeen = true
      pendingUploads.push(uploadOne(name, fileStream, info))
    })

    busboy.on('error', (error) => {
      logUpload('multipart parser failed', { message: error instanceof Error ? error.message : 'Unknown error' })
      if (!responded) {
        responded = true
        next(error)
      }
    })

    busboy.on('finish', () => {
      if (!responded && !fileSeen) return fail(400, 'UPLOAD_FILE_REQUIRED', 'file field required.')
      Promise.all(pendingUploads).then(() => {
        if (responded) return
        responded = true
        logUpload('response sent', { completed: completed.length, failed: failed.length })
        if (completed.length === 0) return res.status(400).json({ code: failed[0]?.code ?? 'UPLOAD_FAILED', message: failed[0]?.message ?? 'Upload failed', failed })
        if (!batchMeta && completed.length === 1 && failed.length === 0) return res.status(201).json({ file: completed[0] })
        return res.status(201).json({ files: completed, failed })
      }).catch(next)
    })

    req.pipe(busboy)
  } catch (error) {
    return next(error)
  }
}

uploadRouter.post('/', requireAuth, handleUpload)
