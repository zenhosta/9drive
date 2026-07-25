import type { ConnectedAccount, File } from '@prisma/client'
import type { Response } from 'express'
import { Readable } from 'node:stream'
import { streamGoogleFile, fetchGoogleFileStream } from './stream-google-file.js'
import { streamS3File, fetchS3FileStream } from '../s3/s3.service.js'
import { decryptDEK, deriveEncryptionMasterKey, ChunkedDecryptTransform, decryptChunkBuffer, mapPlaintextRangeToEncryptedRange, GCM_NONCE_LENGTH, GCM_TAG_LENGTH, DEFAULT_CHUNK_SIZE } from '../../utils/file-crypto.js'
import { env } from '../../config/env.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

export function streamProviderFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  if (file.isEncrypted) return streamEncryptedFile(file, range, res, options)
  if (file.provider === 's3') return streamS3File(file, range, res, options)
  return streamGoogleFile(file, range, res, options)
}

function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  return `${type}; filename="${fileName.replaceAll('"', '')}"`
}

async function streamEncryptedFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  if (!file.encryptedDEK || !file.dekIV || !file.dekAuthTag || !file.fileNonce) {
    return res.status(500).json({ code: 'ENCRYPTION_METADATA_MISSING', message: 'File encryption metadata is missing.' })
  }

  const masterKey = deriveEncryptionMasterKey(env.TOKEN_ENCRYPTION_KEY)
  const dek = decryptDEK(file.encryptedDEK, file.dekIV, file.dekAuthTag, masterKey)
  const fileNonce = Buffer.from(file.fileNonce, 'base64')
  const plaintextSize = file.plaintextSize ?? file.sizeBytes
  const chunkSize = DEFAULT_CHUNK_SIZE

  if (!range) {
    // Full file download — stream through decrypt transform
    const rawStream = await fetchProviderStream(file)
    const decryptor = new ChunkedDecryptTransform(dek)

    res.status(200)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Length', plaintextSize.toString())
    if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, file.name))

    rawStream.pipe(decryptor).pipe(res)
    decryptor.on('error', (err) => {
      console.error('[stream] Decryption error:', err.message)
      if (!res.headersSent) res.status(500).json({ code: 'DECRYPTION_FAILED', message: 'File decryption failed.' })
      else res.destroy()
    })
    return
  }

  // Range request — decrypt only the needed chunks
  const rangeMatch = range.match(/bytes=(\d+)-(\d*)/)
  if (!rangeMatch) {
    return res.status(416).json({ code: 'INVALID_RANGE', message: 'Invalid Range header.' })
  }

  const ptStart = parseInt(rangeMatch[1], 10)
  const ptEnd = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : Number(plaintextSize) - 1

  if (ptStart >= Number(plaintextSize) || ptEnd >= Number(plaintextSize) || ptStart > ptEnd) {
    res.setHeader('Content-Range', `bytes */${plaintextSize}`)
    return res.status(416).json({ code: 'RANGE_NOT_SATISFIABLE', message: 'Range not satisfiable.' })
  }

  const mapped = mapPlaintextRangeToEncryptedRange(ptStart, ptEnd, chunkSize)
  const encRange = `bytes=${mapped.encryptedStart}-${mapped.encryptedEnd}`

  const rawStream = await fetchProviderStream(file, encRange)

  // Collect encrypted chunks, decrypt each, slice to requested range
  const encChunks: Buffer[] = []
  rawStream.on('data', (chunk: Buffer) => encChunks.push(chunk))
  await new Promise<void>((resolve, reject) => {
    rawStream.on('end', resolve)
    rawStream.on('error', reject)
  })

  const encData = Buffer.concat(encChunks)
  const encChunkSize = GCM_NONCE_LENGTH + chunkSize + GCM_TAG_LENGTH
  const plaintextChunks: Buffer[] = []

  for (let i = mapped.firstChunk; i <= mapped.lastChunk; i++) {
    const offset = (i - mapped.firstChunk) * encChunkSize
    const isLastFileChunk = offset + encChunkSize > encData.length
    const chunkEnd = isLastFileChunk ? encData.length : offset + encChunkSize
    const encChunk = encData.subarray(offset, chunkEnd)
    plaintextChunks.push(decryptChunkBuffer(encChunk, i, fileNonce, dek))
  }

  const fullPlaintext = Buffer.concat(plaintextChunks)
  const sliced = fullPlaintext.subarray(mapped.sliceStart, mapped.sliceStart + (ptEnd - ptStart + 1))

  const contentLength = sliced.length
  res.status(206)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Range', `bytes ${ptStart}-${ptEnd}/${plaintextSize}`)
  res.setHeader('Content-Length', contentLength.toString())
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, file.name))
  res.end(sliced)
}

async function fetchProviderStream(file: FileWithAccount, range?: string): Promise<Readable> {
  if (file.provider === 's3') {
    const result = await fetchS3FileStream(file, range)
    return result.stream
  }
  const result = await fetchGoogleFileStream(file, range)
  return Readable.fromWeb(result.stream as any)
}
