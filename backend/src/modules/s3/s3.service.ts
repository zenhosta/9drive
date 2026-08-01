import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { ConnectedAccount, File, S3StorageConfig } from '@prisma/client'
import type { Response } from 'express'
import type { Readable } from 'node:stream'
import { prisma } from '../../config/prisma.js'
import { decryptText } from '../../utils/crypto.js'

type S3Config = S3StorageConfig
type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  return `${type}; filename="${fileName.replaceAll('"', '')}"`
}

export function createS3Client(config: S3Config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint ?? undefined,
    forcePathStyle: config.forcePathStyle || Boolean(config.endpoint),
    credentials: {
      accessKeyId: decryptText(config.accessKeyIdEncrypted),
      secretAccessKey: decryptText(config.secretAccessKeyEncrypted),
    },
  })
}

export async function getS3ConfigForAccount(accountId: string, userId?: string) {
  return prisma.s3StorageConfig.findFirstOrThrow({ where: { connectedAccountId: accountId, status: 'active', ...(userId ? { userId } : {}) } })
}

export async function testS3Connection(config: S3Config) {
  const client = createS3Client(config)
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
}

function safeFileName(name: string) {
  return name.replace(/[\\/]+/g, '-').replace(/[\u0000-\u001f\u007f]+/g, '').slice(0, 180) || 'file'
}

export function buildS3ObjectKey(config: Pick<S3Config, 'prefix'>, userId: string, fileId: string, fileName: string) {
  return `${config.prefix.replace(/^\/+|\/+$/g, '')}/${userId}/${fileId}/${safeFileName(fileName)}`
}

export async function uploadS3Object(config: S3Config, key: string, body: NodeJS.ReadableStream, mimeType: string) {
  const client = createS3Client(config)
  await new Upload({
    client,
    params: { Bucket: config.bucket, Key: key, Body: body as Readable, ContentType: mimeType },
  }).done()
}

export async function deleteS3Object(file: FileWithAccount) {
  const config = await getS3ConfigForAccount(file.connectedAccountId)
  const client = createS3Client(config)
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
}

export async function syncS3Quota(accountId: string) {
  const config = await getS3ConfigForAccount(accountId)
  const client = createS3Client(config)
  let usedBytes = 0n
  let continuationToken: string | undefined
  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, ContinuationToken: continuationToken }))
    for (const object of response.Contents ?? []) usedBytes += BigInt(object.Size ?? 0)
    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: {
      connectedAccountId: accountId,
      totalBytes: config.quotaBytes,
      usedBytes,
      availableBytes: config.quotaBytes === null ? null : config.quotaBytes - usedBytes,
      lastSyncedAt: new Date(),
    },
    update: {
      totalBytes: config.quotaBytes,
      usedBytes,
      availableBytes: config.quotaBytes === null ? null : config.quotaBytes - usedBytes,
      lastSyncedAt: new Date(),
    },
  })
}

export async function streamS3File(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  const config = await getS3ConfigForAccount(file.connectedAccountId)
  const client = createS3Client(config)
  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId, Range: range }))

  res.status(response.ContentRange ? 206 : 200)
  res.setHeader('Content-Type', response.ContentType ?? file.mimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, file.name))
  if (response.ContentLength !== undefined) res.setHeader('Content-Length', response.ContentLength.toString())
  if (response.ContentRange) res.setHeader('Content-Range', response.ContentRange)

  const body = response.Body as Readable | undefined
  if (!body) return res.end()
  return body.pipe(res)
}

/** Fetch raw S3 object stream — used by encrypted file handler */
export async function fetchS3FileStream(
  file: FileWithAccount,
  range?: string
): Promise<{ stream: Readable; contentLength?: number; contentRange?: string }> {
  const config = await getS3ConfigForAccount(file.connectedAccountId)
  const client = createS3Client(config)
  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId, Range: range }))
  const body = response.Body as Readable
  if (!body) throw new Error('S3 returned empty body')
  return {
    stream: body,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
  }
}
