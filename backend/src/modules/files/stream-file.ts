import type { ConnectedAccount, File } from '@prisma/client'
import type { Response } from 'express'
import { Readable, Transform } from 'node:stream'
import { streamGoogleFile, fetchGoogleFileStream } from './stream-google-file.js'
import { streamS3File, fetchS3FileStream } from '../s3/s3.service.js'
import {
  decryptDEK,
  deriveEncryptionMasterKey,
  ChunkedDecryptTransform,
  decryptChunkBuffer,
  mapPlaintextRangeToEncryptedRange,
  GCM_NONCE_LENGTH,
  GCM_TAG_LENGTH,
  DEFAULT_CHUNK_SIZE,
} from '../../utils/file-crypto.js'
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

async function fetchProviderStream(file: FileWithAccount, range?: string): Promise<Readable> {
  if (file.provider === 's3') {
    const result = await fetchS3FileStream(file, range)
    return result.stream
  }
  const result = await fetchGoogleFileStream(file, range)
  return Readable.fromWeb(result.stream as any)
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
    // Full file download — stream raw ciphertext through decrypt transform directly into response
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

  // Range request — decrypt needed chunks with streaming backpressure (Blocker 6)
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

  const mapped = mapPlaintextRangeToEncryptedRange(ptStart, ptEnd, Number(plaintextSize), chunkSize)
  const encRange = `bytes=${mapped.encryptedStart}-${mapped.encryptedEnd}`

  const rawStream = await fetchProviderStream(file, encRange)

  // Stream encrypted chunks transform directly into res without buffering full range in memory
  const encChunkSize = GCM_NONCE_LENGTH + chunkSize + GCM_TAG_LENGTH

  let currentChunkIndex = mapped.firstChunk
  let buffer = Buffer.alloc(0)
  let slicedBytesSent = 0
  const requestedLength = ptEnd - ptStart + 1

  res.status(206)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Range', `bytes ${ptStart}-${ptEnd}/${plaintextSize}`)
  res.setHeader('Content-Length', requestedLength.toString())
  if (options.disposition) res.setHeader('Content-Disposition', contentDisposition(options.disposition, file.name))

  const rangeDecryptor = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      buffer = Buffer.concat([buffer, chunk])
      try {
        while (buffer.length >= encChunkSize || (currentChunkIndex === mapped.lastChunk && buffer.length > 0)) {
          const isLastFileChunk = currentChunkIndex === mapped.totalChunks - 1
          const targetLen = isLastFileChunk ? buffer.length : encChunkSize
          if (buffer.length < targetLen && currentChunkIndex !== mapped.lastChunk) break

          const encChunk = buffer.subarray(0, targetLen)
          buffer = buffer.subarray(targetLen)

          const decrypted = decryptChunkBuffer(encChunk, currentChunkIndex, isLastFileChunk, fileNonce, dek)
          currentChunkIndex++

          // Slice to requested byte bounds on first/last chunk
          let startOffset = 0
          if (currentChunkIndex - 1 === mapped.firstChunk) {
            startOffset = mapped.sliceStart
          }
          let endOffset = decrypted.length
          if (slicedBytesSent + (endOffset - startOffset) > requestedLength) {
            endOffset = startOffset + (requestedLength - slicedBytesSent)
          }

          const slice = decrypted.subarray(startOffset, endOffset)
          slicedBytesSent += slice.length
          this.push(slice)
        }
        callback()
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })

  rawStream.pipe(rangeDecryptor).pipe(res)
  rangeDecryptor.on('error', (err) => {
    console.error('[stream] Encrypted range decryption error:', err.message)
    if (!res.headersSent) res.status(500).json({ code: 'DECRYPTION_FAILED', message: 'Range decryption failed.' })
    else res.destroy()
  })
}
