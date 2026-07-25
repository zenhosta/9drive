/**
 * file-crypto.ts — Chunked AES-256-GCM file encryption for 9Drive
 *
 * File format:
 *   [Header: 40B] [Chunk0] [Chunk1] ... [ChunkN]
 *
 * Header (40 bytes):
 *   Magic         : "9DRV"          (4 bytes)
 *   Version       : 0x01            (1 byte)
 *   Algorithm     : 0x01 = AES-256-GCM (1 byte)
 *   Chunk Size    : uint32 BE       (4 bytes) — plaintext chunk size
 *   File Nonce    : random          (16 bytes)
 *   Reserved      : zeros           (14 bytes)
 *
 * Chunk (CHUNK_SIZE + 28 bytes overhead):
 *   Nonce         : derived(fileNonce, chunkIndex) (12 bytes)
 *   Ciphertext    : encrypted data  (≤ CHUNK_SIZE bytes)
 *   Auth Tag      : GCM tag         (16 bytes)
 *
 * Per-chunk nonce is derived deterministically:
 *   nonce[0..7]  = fileNonce[0..7]
 *   nonce[8..11] = fileNonce[8..11] XOR bigEndian(chunkIndex)
 *
 * Chunk index is included in AAD to prevent reordering attacks.
 */

import crypto from 'node:crypto'
import { Transform, type TransformCallback } from 'node:stream'

/* ── Constants ───────────────────────────────────────────────────────── */

const MAGIC = Buffer.from('9DRV')
const VERSION = 0x01
const ALGO_AES_256_GCM = 0x01
const HEADER_SIZE = 40
const FILE_NONCE_LENGTH = 16
const GCM_NONCE_LENGTH = 12
const GCM_TAG_LENGTH = 16
const DEFAULT_CHUNK_SIZE = 64 * 1024 // 64 KiB

export { HEADER_SIZE, GCM_TAG_LENGTH, GCM_NONCE_LENGTH, DEFAULT_CHUNK_SIZE }

/* ── Key Management ──────────────────────────────────────────────────── */

/**
 * Derive a 256-bit file encryption master key from TOKEN_ENCRYPTION_KEY
 * using HKDF with SHA-256. This separates the token-encryption key domain
 * from the file-encryption key domain.
 */
export function deriveEncryptionMasterKey(tokenEncryptionKey: string): Buffer {
  const ikm = Buffer.from(tokenEncryptionKey, 'utf8')
  const salt = Buffer.from('9drive-file-encryption-v1', 'utf8')
  const info = Buffer.from('file-master-key', 'utf8')
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32))
}

/** Generate a random 32-byte Data Encryption Key for a single file. */
export function generateFileDEK(): Buffer {
  return crypto.randomBytes(32)
}

/** Encrypt a file DEK with the master key for storage in DB. */
export function encryptDEK(
  dek: Buffer,
  masterKey: Buffer
): { encryptedDEK: string; dekIV: string; dekAuthTag: string } {
  const iv = crypto.randomBytes(GCM_NONCE_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: GCM_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    encryptedDEK: encrypted.toString('base64'),
    dekIV: iv.toString('base64'),
    dekAuthTag: tag.toString('base64'),
  }
}

/** Decrypt a file DEK from DB using the master key. */
export function decryptDEK(
  encryptedDEK: string,
  dekIV: string,
  dekAuthTag: string,
  masterKey: Buffer
): Buffer {
  const iv = Buffer.from(dekIV, 'base64')
  const tag = Buffer.from(dekAuthTag, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv, { authTagLength: GCM_TAG_LENGTH })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(Buffer.from(encryptedDEK, 'base64')), decipher.final()])
}

/* ── Nonce Derivation ────────────────────────────────────────────────── */

/** Derive a 12-byte GCM nonce for a specific chunk from the file nonce + chunk index. */
function deriveChunkNonce(fileNonce: Buffer, chunkIndex: number): Buffer {
  const nonce = Buffer.alloc(GCM_NONCE_LENGTH)
  fileNonce.copy(nonce, 0, 0, GCM_NONCE_LENGTH)
  // XOR last 4 bytes with big-endian chunk index
  const indexBuf = Buffer.alloc(4)
  indexBuf.writeUInt32BE(chunkIndex)
  for (let i = 0; i < 4; i++) {
    nonce[8 + i] ^= indexBuf[i]
  }
  return nonce
}

/** Build AAD for a chunk: includes chunk index to prevent reordering. */
function buildChunkAAD(chunkIndex: number): Buffer {
  const aad = Buffer.alloc(8)
  aad.write('9D', 0, 'ascii') // domain separator
  aad.writeUInt16BE(VERSION, 2)
  aad.writeUInt32BE(chunkIndex, 4)
  return aad
}

/* ── File Header ─────────────────────────────────────────────────────── */

export function buildFileHeader(fileNonce: Buffer, chunkSize: number = DEFAULT_CHUNK_SIZE): Buffer {
  const header = Buffer.alloc(HEADER_SIZE)
  MAGIC.copy(header, 0)
  header.writeUInt8(VERSION, 4)
  header.writeUInt8(ALGO_AES_256_GCM, 5)
  header.writeUInt32BE(chunkSize, 6)
  fileNonce.copy(header, 10, 0, FILE_NONCE_LENGTH)
  // bytes 26-39 are reserved (zeros)
  return header
}

export function parseFileHeader(header: Buffer): {
  version: number
  algorithm: number
  chunkSize: number
  fileNonce: Buffer
} {
  if (header.length < HEADER_SIZE) throw new Error('Invalid encrypted file: header too short')
  const magic = header.subarray(0, 4)
  if (!magic.equals(MAGIC)) throw new Error('Invalid encrypted file: bad magic')
  return {
    version: header.readUInt8(4),
    algorithm: header.readUInt8(5),
    chunkSize: header.readUInt32BE(6),
    fileNonce: Buffer.from(header.subarray(10, 10 + FILE_NONCE_LENGTH)),
  }
}

/* ── Encrypt Transform Stream ────────────────────────────────────────── */

/**
 * Transform stream that encrypts data using chunked AES-256-GCM.
 * Emits: [40B header] [chunk0: nonce+ciphertext+tag] [chunk1] ... [chunkN]
 */
export class ChunkedEncryptTransform extends Transform {
  private dek: Buffer
  private fileNonce: Buffer
  private chunkSize: number
  private chunkIndex = 0
  private pending: Buffer = Buffer.alloc(0)
  private headerEmitted = false

  constructor(dek: Buffer, fileNonce?: Buffer, chunkSize: number = DEFAULT_CHUNK_SIZE) {
    super()
    this.dek = dek
    this.fileNonce = fileNonce ?? crypto.randomBytes(FILE_NONCE_LENGTH)
    this.chunkSize = chunkSize
  }

  getFileNonce(): Buffer {
    return this.fileNonce
  }

  private emitHeader() {
    if (!this.headerEmitted) {
      this.push(buildFileHeader(this.fileNonce, this.chunkSize))
      this.headerEmitted = true
    }
  }

  private encryptChunk(plaintext: Buffer): Buffer {
    const nonce = deriveChunkNonce(this.fileNonce, this.chunkIndex)
    const aad = buildChunkAAD(this.chunkIndex)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.dek, nonce, { authTagLength: GCM_TAG_LENGTH })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    this.chunkIndex++
    return Buffer.concat([nonce, ciphertext, tag])
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    this.emitHeader()
    this.pending = Buffer.concat([this.pending, chunk])

    while (this.pending.length >= this.chunkSize) {
      const plainChunk = this.pending.subarray(0, this.chunkSize)
      this.pending = this.pending.subarray(this.chunkSize)
      this.push(this.encryptChunk(plainChunk))
    }
    callback()
  }

  _flush(callback: TransformCallback) {
    this.emitHeader()
    // Encrypt any remaining bytes as the final (possibly smaller) chunk
    if (this.pending.length > 0) {
      this.push(this.encryptChunk(this.pending))
      this.pending = Buffer.alloc(0)
    }
    callback()
  }
}

/* ── Decrypt Transform Stream ────────────────────────────────────────── */

/**
 * Transform stream that decrypts chunked AES-256-GCM data.
 * Expects: [40B header] [chunk0: nonce+ciphertext+tag] [chunk1] ... [chunkN]
 *
 * For full-file decryption only (no seeking). For range decryption, use
 * decryptChunkBuffer() directly after fetching the right encrypted chunks.
 */
export class ChunkedDecryptTransform extends Transform {
  private dek: Buffer
  private buffer: Buffer = Buffer.alloc(0)
  private headerParsed = false
  private fileNonce: Buffer = Buffer.alloc(0)
  private chunkSize = DEFAULT_CHUNK_SIZE
  private encryptedChunkSize = 0
  private chunkIndex = 0

  constructor(dek: Buffer) {
    super()
    this.dek = dek
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    this.buffer = Buffer.concat([this.buffer, chunk])

    try {
      // Parse header first
      if (!this.headerParsed) {
        if (this.buffer.length < HEADER_SIZE) return callback()
        const header = parseFileHeader(this.buffer.subarray(0, HEADER_SIZE))
        this.fileNonce = header.fileNonce
        this.chunkSize = header.chunkSize
        this.encryptedChunkSize = GCM_NONCE_LENGTH + this.chunkSize + GCM_TAG_LENGTH
        this.buffer = this.buffer.subarray(HEADER_SIZE)
        this.headerParsed = true
      }

      // Process complete encrypted chunks
      // Note: last chunk may be smaller, so we only process if we have more data coming
      // or in _flush. We process chunks that are exactly encryptedChunkSize.
      while (this.buffer.length >= this.encryptedChunkSize) {
        const encChunk = this.buffer.subarray(0, this.encryptedChunkSize)
        this.buffer = this.buffer.subarray(this.encryptedChunkSize)
        this.push(this.decryptOneChunk(encChunk, this.chunkSize))
      }

      callback()
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)))
    }
  }

  _flush(callback: TransformCallback) {
    try {
      // Handle the last chunk which may be smaller than chunkSize
      if (this.buffer.length > 0) {
        if (this.buffer.length < GCM_NONCE_LENGTH + 1 + GCM_TAG_LENGTH) {
          return callback(new Error('Decryption failed: truncated final chunk'))
        }
        this.push(this.decryptOneChunk(this.buffer, this.buffer.length - GCM_NONCE_LENGTH - GCM_TAG_LENGTH))
        this.buffer = Buffer.alloc(0)
      }
      callback()
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private decryptOneChunk(encChunk: Buffer, expectedPlaintextSize: number): Buffer {
    const nonce = encChunk.subarray(0, GCM_NONCE_LENGTH)
    const ciphertext = encChunk.subarray(GCM_NONCE_LENGTH, encChunk.length - GCM_TAG_LENGTH)
    const tag = encChunk.subarray(encChunk.length - GCM_TAG_LENGTH)

    // Verify nonce matches expected derived nonce
    const expectedNonce = deriveChunkNonce(this.fileNonce, this.chunkIndex)
    if (!nonce.equals(expectedNonce)) {
      throw new Error(`Decryption failed: chunk ${this.chunkIndex} nonce mismatch (possible reordering attack)`)
    }

    const aad = buildChunkAAD(this.chunkIndex)
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.dek, nonce, { authTagLength: GCM_TAG_LENGTH })
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    this.chunkIndex++
    return plaintext
  }
}

/* ── Single Chunk Decryption (for range requests) ────────────────────── */

/**
 * Decrypt a single encrypted chunk buffer, given its chunk index and the file nonce.
 * Used for range-request decryption where only specific chunks are fetched.
 */
export function decryptChunkBuffer(
  encChunk: Buffer,
  chunkIndex: number,
  fileNonce: Buffer,
  dek: Buffer
): Buffer {
  const nonce = encChunk.subarray(0, GCM_NONCE_LENGTH)
  const ciphertext = encChunk.subarray(GCM_NONCE_LENGTH, encChunk.length - GCM_TAG_LENGTH)
  const tag = encChunk.subarray(encChunk.length - GCM_TAG_LENGTH)

  const expectedNonce = deriveChunkNonce(fileNonce, chunkIndex)
  if (!nonce.equals(expectedNonce)) {
    throw new Error(`Decryption failed: chunk ${chunkIndex} nonce mismatch`)
  }

  const aad = buildChunkAAD(chunkIndex)
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonce, { authTagLength: GCM_TAG_LENGTH })
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/* ── Range Request Mapping ───────────────────────────────────────────── */

/**
 * Map a plaintext byte range to the encrypted byte range needed to fulfill it.
 * Returns the encrypted byte offsets to fetch from storage, and which chunks
 * to decrypt and how to slice them.
 */
export function mapPlaintextRangeToEncryptedRange(
  plaintextStart: number,
  plaintextEnd: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): {
  firstChunk: number
  lastChunk: number
  encryptedStart: number
  encryptedEnd: number
  /** Offset within first decrypted chunk to start serving from */
  sliceStart: number
  /** Offset within last decrypted chunk to stop serving at (exclusive) */
  sliceEnd: number
} {
  const encChunkSize = GCM_NONCE_LENGTH + chunkSize + GCM_TAG_LENGTH

  const firstChunk = Math.floor(plaintextStart / chunkSize)
  const lastChunk = Math.floor(plaintextEnd / chunkSize)

  const encryptedStart = HEADER_SIZE + firstChunk * encChunkSize
  const encryptedEnd = HEADER_SIZE + (lastChunk + 1) * encChunkSize - 1

  const sliceStart = plaintextStart - firstChunk * chunkSize
  const sliceEnd = plaintextEnd - lastChunk * chunkSize + 1

  return { firstChunk, lastChunk, encryptedStart, encryptedEnd, sliceStart, sliceEnd }
}

/**
 * Calculate the encrypted file size from the plaintext file size.
 */
export function encryptedFileSize(plaintextSize: number, chunkSize: number = DEFAULT_CHUNK_SIZE): number {
  const numChunks = Math.ceil(plaintextSize / chunkSize) || 1 // at least 1 chunk for empty files
  const perChunkOverhead = GCM_NONCE_LENGTH + GCM_TAG_LENGTH // 28 bytes
  return HEADER_SIZE + plaintextSize + numChunks * perChunkOverhead
}
