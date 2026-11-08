import { Readable } from 'node:stream'
import type { CloudinaryConfig, ConnectedAccount, File } from '@prisma/client'
import type { Response } from 'express'
import { prisma } from '../../config/prisma.js'
import { decryptText } from '../../utils/crypto.js'
import { buildProviderFileId, cloudinaryResourceType, parseProviderFileId, signParams, type ResourceType } from './cloudinary.utils.js'

export { buildCloudinaryPublicId, cloudinaryResourceType } from './cloudinary.utils.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

const apiBase = 'https://api.cloudinary.com/v1_1'
const deliveryBase = 'https://res.cloudinary.com'

function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  return `${type}; filename="${fileName.replaceAll('"', '')}"`
}

function credentials(config: CloudinaryConfig) {
  return { apiKey: decryptText(config.apiKeyEncrypted), apiSecret: decryptText(config.apiSecretEncrypted) }
}

async function readCloudinaryError(response: globalThis.Response) {
  const text = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // not JSON; fall through
  }
  return text.slice(0, 200) || `HTTP ${response.status}`
}

export async function getCloudinaryConfigForAccount(accountId: string, userId?: string) {
  return prisma.cloudinaryConfig.findFirstOrThrow({ where: { connectedAccountId: accountId, status: 'active', ...(userId ? { userId } : {}) } })
}

export function getCloudinaryDeliveryUrl(config: Pick<CloudinaryConfig, 'cloudName'>, providerFileId: string) {
  const { resourceType, path } = parseProviderFileId(providerFileId)
  return `${deliveryBase}/${config.cloudName}/${resourceType}/upload/${path}`
}

export async function uploadCloudinaryObject(config: CloudinaryConfig, publicId: string, body: Buffer, mimeType: string, fileName: string) {
  const { apiKey, apiSecret } = credentials(config)
  const resourceType = cloudinaryResourceType(mimeType)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signed = { public_id: publicId, timestamp }

  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(body)], { type: mimeType }), fileName)
  form.set('api_key', apiKey)
  form.set('public_id', publicId)
  form.set('timestamp', timestamp)
  form.set('signature', signParams(signed, apiSecret))

  const response = await fetch(`${apiBase}/${config.cloudName}/${resourceType}/upload`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`Cloudinary upload failed: ${await readCloudinaryError(response)}`)
  const result = (await response.json()) as { public_id: string; format?: string; resource_type: ResourceType }
  return buildProviderFileId(result.resource_type ?? resourceType, result.public_id, result.format)
}

export async function deleteCloudinaryObject(file: FileWithAccount) {
  const config = await getCloudinaryConfigForAccount(file.connectedAccountId)
  const { apiKey, apiSecret } = credentials(config)
  const { resourceType, publicId } = parseProviderFileId(file.providerFileId)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signed = { invalidate: 'true', public_id: publicId, timestamp }

  const form = new URLSearchParams({ ...signed, api_key: apiKey, signature: signParams(signed, apiSecret) })
  const response = await fetch(`${apiBase}/${config.cloudName}/${resourceType}/destroy`, { method: 'POST', body: form })
  if (!response.ok) throw new Error(`Cloudinary delete failed: ${await readCloudinaryError(response)}`)
  const result = (await response.json()) as { result?: string }
  if (result.result !== 'ok' && result.result !== 'not found') throw new Error(`Cloudinary delete failed: ${result.result ?? 'unknown result'}`)
}

async function fetchUsage(config: CloudinaryConfig) {
  const { apiKey, apiSecret } = credentials(config)
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  const response = await fetch(`${apiBase}/${config.cloudName}/usage`, { headers: { Authorization: `Basic ${auth}` } })
  if (!response.ok) throw new Error(`Cloudinary rejected the credentials or cloud name: ${await readCloudinaryError(response)}`)
  return (await response.json()) as { storage?: { usage?: number } }
}

export async function testCloudinaryConnection(config: CloudinaryConfig) {
  await fetchUsage(config)
}

export async function syncCloudinaryQuota(accountId: string) {
  const config = await getCloudinaryConfigForAccount(accountId)
  const usage = await fetchUsage(config)
  const reportedBytes = BigInt(Math.max(0, Math.round(usage.storage?.usage ?? 0)))
  // Cloudinary's usage figure can lag behind recent uploads, so never report less than what this app has stored there.
  const tracked = await prisma.file.aggregate({ where: { connectedAccountId: accountId }, _sum: { sizeBytes: true } })
  const trackedBytes = tracked._sum.sizeBytes ?? 0n
  const usedBytes = reportedBytes > trackedBytes ? reportedBytes : trackedBytes

  const values = {
    totalBytes: config.quotaBytes,
    usedBytes,
    availableBytes: config.quotaBytes === null ? null : config.quotaBytes - usedBytes,
    lastSyncedAt: new Date(),
  }
  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: { connectedAccountId: accountId, ...values },
    update: values,
  })
}

async function openDeliveryResponse(file: FileWithAccount, range?: string) {
  const config = await getCloudinaryConfigForAccount(file.connectedAccountId)
  const response = await fetch(getCloudinaryDeliveryUrl(config, file.providerFileId), { headers: range ? { Range: range } : {} })
  if (!response.ok || !response.body) {
    const hint = response.status === 401 || response.status === 403
      ? ' (for PDF/ZIP/raw files, enable "Allow delivery of PDF and ZIP files" in the Cloudinary security settings)'
      : ''
    throw new Error(`Cloudinary delivery failed with HTTP ${response.status}${hint}`)
  }
  return response
}

export async function openCloudinaryStream(file: FileWithAccount) {
  const response = await openDeliveryResponse(file)
  return Readable.fromWeb(response.body as any)
}

export async function streamCloudinaryFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  const upstream = await openDeliveryResponse(file, range)
  res.status(upstream.status === 206 ? 206 : 200)
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? file.mimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, file.name))
  const length = upstream.headers.get('content-length')
  if (length) res.setHeader('Content-Length', length)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) res.setHeader('Content-Range', contentRange)
  return Readable.fromWeb(upstream.body as any).pipe(res)
}
