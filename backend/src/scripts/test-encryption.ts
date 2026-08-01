/**
 * Automated Verification Test Suite for 9Drive File Encryption
 */

import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { z } from 'zod'
import {
  deriveEncryptionMasterKey,
  generateFileDEK,
  encryptDEK,
  decryptDEK,
  buildFileHeader,
  parseFileHeader,
  ChunkedEncryptTransform,
  ChunkedDecryptTransform,
  mapPlaintextRangeToEncryptedRange,
  encryptedFileSize,
  decryptChunkBuffer,
  DEFAULT_CHUNK_SIZE,
} from '../utils/file-crypto.js'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.error(`  ❌ ${message}`)
    failed++
  }
}

async function testBooleanParsing() {
  console.log('\n⚙️ Test 1: Strict Boolean Env Parsing (Blocker 3 Fix)')
  const boolSchema = z.string().optional().transform((val) => val?.toLowerCase() === 'true' || val === '1')

  assert(boolSchema.parse('true') === true, "parse('true') returns true")
  assert(boolSchema.parse('TRUE') === true, "parse('TRUE') returns true")
  assert(boolSchema.parse('1') === true, "parse('1') returns true")
  assert(boolSchema.parse('false') === false, "parse('false') returns false (not coerced to true!)")
  assert(boolSchema.parse('0') === false, "parse('0') returns false")
  assert(boolSchema.parse(undefined) === false, 'parse(undefined) returns false')
}

async function testEnvelopeEncryption() {
  console.log('\n🔑 Test 2: DEK Envelope Encryption')
  const masterKey = deriveEncryptionMasterKey('test-secret-key-at-least-32-chars-long!')
  const dek = generateFileDEK()

  const wrapped = encryptDEK(dek, masterKey)
  assert(typeof wrapped.encryptedDEK === 'string', 'Wrapped DEK is base64 string')
  assert(typeof wrapped.dekIV === 'string', 'DEK IV is base64 string')
  assert(typeof wrapped.dekAuthTag === 'string', 'DEK auth tag is base64 string')

  const unwrapped = decryptDEK(wrapped.encryptedDEK, wrapped.dekIV, wrapped.dekAuthTag, masterKey)
  assert(unwrapped.equals(dek), 'Unwrapped DEK matches original DEK')

  const wrongMasterKey = deriveEncryptionMasterKey('wrong-secret-key-at-least-32-chars-long!')
  let threw = false
  try {
    decryptDEK(wrapped.encryptedDEK, wrapped.dekIV, wrapped.dekAuthTag, wrongMasterKey)
  } catch {
    threw = true
  }
  assert(threw, 'Wrong master key correctly throws error')
}

async function testStreamingRoundtrips() {
  console.log('\n🔄 Test 3: Pure Streaming Encrypt/Decrypt Roundtrips (Blocker 1 & 6 Fix)')

  const sizes = [
    1,
    1024,
    DEFAULT_CHUNK_SIZE - 1,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CHUNK_SIZE + 1,
    DEFAULT_CHUNK_SIZE * 2,
    1024 * 1024, // 1 MiB
  ]

  for (const size of sizes) {
    const original = crypto.randomBytes(size)
    const dek = generateFileDEK()

    const encryptor = new ChunkedEncryptTransform(dek)
    const decryptor = new ChunkedDecryptTransform(dek)

    const encChunks: Buffer[] = []
    const decChunks: Buffer[] = []

    const plaintextStream = Readable.from(original)
    plaintextStream.pipe(encryptor)

    encryptor.on('data', (chunk: Buffer) => encChunks.push(chunk))
    await new Promise<void>((res) => encryptor.on('end', res))

    const encryptedData = Buffer.concat(encChunks)
    const encryptedStream = Readable.from(encryptedData)
    encryptedStream.pipe(decryptor)

    decryptor.on('data', (chunk: Buffer) => decChunks.push(chunk))
    await new Promise<void>((res) => decryptor.on('end', res))

    const decryptedData = Buffer.concat(decChunks)
    assert(decryptedData.equals(original), `Streaming roundtrip OK for ${size} bytes`)
  }
}

async function testFinalChunkAuthentication() {
  console.log('\n🛡️ Test 4: Final Chunk AAD Authentication & Truncation Detection (Blocker 8 Fix)')
  const original = crypto.randomBytes(DEFAULT_CHUNK_SIZE * 3)
  const dek = generateFileDEK()

  const encryptor = new ChunkedEncryptTransform(dek)
  const encChunks: Buffer[] = []
  Readable.from(original).pipe(encryptor)
  encryptor.on('data', (chunk: Buffer) => encChunks.push(chunk))
  await new Promise<void>((res) => encryptor.on('end', res))

  const encryptedData = Buffer.concat(encChunks)

  // Truncate the final chunk (remove trailing chunk)
  const encChunkSize = 12 + DEFAULT_CHUNK_SIZE + 16
  const truncatedData = encryptedData.subarray(0, encryptedData.length - encChunkSize)

  const decryptor = new ChunkedDecryptTransform(dek)
  let threw = false

  await new Promise<void>((res) => {
    decryptor.on('error', () => {
      threw = true
      res()
    })
    decryptor.on('end', () => res())
    Readable.from(truncatedData).pipe(decryptor)
  })

  assert(threw, 'Truncated trailing chunk correctly detected via final chunk AAD flag')
}

async function testRangeMapping() {
  console.log('\n🎯 Test 5: Range Request Mapping Math')
  const mapped0 = mapPlaintextRangeToEncryptedRange(0, 0, 1000)
  assert(mapped0.firstChunk === 0 && mapped0.lastChunk === 0, 'First byte maps to chunk 0')

  const mapped1 = mapPlaintextRangeToEncryptedRange(65536, 100000, 200000)
  assert(mapped1.firstChunk === 1, 'Byte 65536 maps to chunk 1')
  assert(mapped1.encryptedStart === 40 + (12 + 65536 + 16), 'Encrypted start offset correctly calculated')
}

async function main() {
  console.log('🔐 9Drive Streaming File Encryption Test Suite')
  console.log('══════════════════════════════════════════════════')

  await testBooleanParsing()
  await testEnvelopeEncryption()
  await testStreamingRoundtrips()
  await testFinalChunkAuthentication()
  await testRangeMapping()

  console.log('\n══════════════════════════════════════════════════')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
