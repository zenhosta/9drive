/**
 * test-encryption.ts — Verify file encryption roundtrip, range requests, and tamper detection.
 *
 * Run: npx tsx src/scripts/test-encryption.ts
 */

import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import {
  generateFileDEK,
  encryptDEK,
  decryptDEK,
  deriveEncryptionMasterKey,
  ChunkedEncryptTransform,
  ChunkedDecryptTransform,
  decryptChunkBuffer,
  mapPlaintextRangeToEncryptedRange,
  encryptedFileSize,
  parseFileHeader,
  HEADER_SIZE,
  GCM_NONCE_LENGTH,
  GCM_TAG_LENGTH,
  DEFAULT_CHUNK_SIZE,
} from '../utils/file-crypto.js'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  ✅ ${message}`)
  } else {
    failed++
    console.error(`  ❌ ${message}`)
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function encryptBuffer(plaintext: Buffer, dek: Buffer): Promise<Buffer> {
  const encryptor = new ChunkedEncryptTransform(dek)
  const readable = Readable.from(plaintext)
  return streamToBuffer(readable.pipe(encryptor))
}

async function decryptBuffer(ciphertext: Buffer, dek: Buffer): Promise<Buffer> {
  const decryptor = new ChunkedDecryptTransform(dek)
  const readable = Readable.from(ciphertext)
  return streamToBuffer(readable.pipe(decryptor))
}

/* ── Test 1: DEK Envelope Encryption ─────────────────────────────── */

async function testDEKEnvelope() {
  console.log('\n🔑 Test 1: DEK Envelope Encryption')
  const masterKey = deriveEncryptionMasterKey('test-token-encryption-key-32chars!')
  const dek = generateFileDEK()

  assert(dek.length === 32, 'DEK is 32 bytes')
  assert(masterKey.length === 32, 'Master key is 32 bytes')

  const wrapped = encryptDEK(dek, masterKey)
  assert(typeof wrapped.encryptedDEK === 'string', 'Wrapped DEK is base64 string')
  assert(typeof wrapped.dekIV === 'string', 'DEK IV is base64 string')
  assert(typeof wrapped.dekAuthTag === 'string', 'DEK auth tag is base64 string')

  const unwrapped = decryptDEK(wrapped.encryptedDEK, wrapped.dekIV, wrapped.dekAuthTag, masterKey)
  assert(unwrapped.equals(dek), 'Unwrapped DEK matches original')

  // Wrong master key should fail
  const wrongKey = deriveEncryptionMasterKey('wrong-key-that-is-32-characters!')
  try {
    decryptDEK(wrapped.encryptedDEK, wrapped.dekIV, wrapped.dekAuthTag, wrongKey)
    assert(false, 'Wrong master key should throw')
  } catch {
    assert(true, 'Wrong master key correctly throws')
  }
}

/* ── Test 2: Encrypt/Decrypt Roundtrip ───────────────────────────── */

async function testRoundtrip() {
  console.log('\n🔄 Test 2: Encrypt/Decrypt Roundtrip')
  const dek = generateFileDEK()

  const sizes = [
    { name: '1 byte', size: 1 },
    { name: '1 KiB', size: 1024 },
    { name: '64 KiB - 1 (just under chunk)', size: 64 * 1024 - 1 },
    { name: '64 KiB (exact chunk)', size: 64 * 1024 },
    { name: '64 KiB + 1 (just over chunk)', size: 64 * 1024 + 1 },
    { name: '128 KiB (2 chunks)', size: 128 * 1024 },
    { name: '1 MiB', size: 1024 * 1024 },
    { name: '3.5 MiB (multi-chunk)', size: 3.5 * 1024 * 1024 },
  ]

  for (const { name, size } of sizes) {
    const plaintext = crypto.randomBytes(size)
    const ciphertext = await encryptBuffer(plaintext, dek)
    const decrypted = await decryptBuffer(ciphertext, dek)
    assert(decrypted.equals(plaintext), `${name} (${size}B) roundtrip OK`)
  }
}

/* ── Test 3: File Header Parsing ─────────────────────────────────── */

async function testHeaderParsing() {
  console.log('\n📋 Test 3: File Header Parsing')
  const dek = generateFileDEK()
  const plaintext = crypto.randomBytes(1000)
  const ciphertext = await encryptBuffer(plaintext, dek)

  const header = parseFileHeader(ciphertext.subarray(0, HEADER_SIZE))
  assert(header.version === 1, 'Version is 1')
  assert(header.algorithm === 1, 'Algorithm is AES-256-GCM (0x01)')
  assert(header.chunkSize === DEFAULT_CHUNK_SIZE, `Chunk size is ${DEFAULT_CHUNK_SIZE}`)
  assert(header.fileNonce.length === 16, 'File nonce is 16 bytes')
}

/* ── Test 4: Encrypted File Size Calculation ─────────────────────── */

async function testSizeCalculation() {
  console.log('\n📐 Test 4: Encrypted File Size Calculation')
  const dek = generateFileDEK()

  const sizes = [1, 1024, 64 * 1024, 64 * 1024 + 1, 1024 * 1024]
  for (const size of sizes) {
    const plaintext = crypto.randomBytes(size)
    const ciphertext = await encryptBuffer(plaintext, dek)
    const expected = encryptedFileSize(size)
    assert(ciphertext.length === expected, `Size calc for ${size}B: expected=${expected}, actual=${ciphertext.length}`)
  }
}

/* ── Test 5: Range Request Mapping ───────────────────────────────── */

async function testRangeMapping() {
  console.log('\n🎯 Test 5: Range Request Mapping')
  const chunkSize = DEFAULT_CHUNK_SIZE
  const encChunkSize = GCM_NONCE_LENGTH + chunkSize + GCM_TAG_LENGTH

  // Request first byte → should map to first chunk
  const r1 = mapPlaintextRangeToEncryptedRange(0, 0, chunkSize)
  assert(r1.firstChunk === 0, 'First byte → chunk 0')
  assert(r1.encryptedStart === HEADER_SIZE, 'Encrypted start at header end')
  assert(r1.sliceStart === 0, 'Slice starts at 0')

  // Request last byte of first chunk → still chunk 0
  const r2 = mapPlaintextRangeToEncryptedRange(chunkSize - 1, chunkSize - 1, chunkSize)
  assert(r2.firstChunk === 0, 'Last byte of chunk 0 → chunk 0')
  assert(r2.lastChunk === 0, 'Still in chunk 0')

  // Request first byte of second chunk → chunk 1
  const r3 = mapPlaintextRangeToEncryptedRange(chunkSize, chunkSize, chunkSize)
  assert(r3.firstChunk === 1, 'First byte of chunk 1 → chunk 1')
  assert(r3.encryptedStart === HEADER_SIZE + encChunkSize, 'Encrypted offset for chunk 1')

  // Cross-chunk range
  const r4 = mapPlaintextRangeToEncryptedRange(chunkSize - 10, chunkSize + 10, chunkSize)
  assert(r4.firstChunk === 0, 'Cross-chunk starts at chunk 0')
  assert(r4.lastChunk === 1, 'Cross-chunk ends at chunk 1')
}

/* ── Test 6: Single Chunk Decryption (for Range Requests) ────────── */

async function testSingleChunkDecrypt() {
  console.log('\n🧩 Test 6: Single Chunk Decryption')
  const dek = generateFileDEK()
  const plaintext = crypto.randomBytes(200000) // ~3 chunks
  const ciphertext = await encryptBuffer(plaintext, dek)

  const header = parseFileHeader(ciphertext.subarray(0, HEADER_SIZE))
  const encChunkSize = GCM_NONCE_LENGTH + header.chunkSize + GCM_TAG_LENGTH

  // Decrypt chunk 1 independently
  const chunk1Start = HEADER_SIZE + encChunkSize
  const chunk1End = chunk1Start + encChunkSize
  const encChunk1 = ciphertext.subarray(chunk1Start, chunk1End)
  const decChunk1 = decryptChunkBuffer(encChunk1, 1, header.fileNonce, dek)

  const expectedChunk1 = plaintext.subarray(header.chunkSize, header.chunkSize * 2)
  assert(decChunk1.equals(expectedChunk1), 'Single chunk decrypt matches expected plaintext')
}

/* ── Test 7: Tamper Detection ────────────────────────────────────── */

async function testTamperDetection() {
  console.log('\n🛡️  Test 7: Tamper Detection')
  const dek = generateFileDEK()
  const plaintext = crypto.randomBytes(10000)
  const ciphertext = await encryptBuffer(plaintext, dek)

  // Flip a bit in the ciphertext (not the header)
  const tampered = Buffer.from(ciphertext)
  tampered[HEADER_SIZE + GCM_NONCE_LENGTH + 10] ^= 0xFF

  try {
    await decryptBuffer(tampered, dek)
    assert(false, 'Tampered ciphertext should fail decryption')
  } catch {
    assert(true, 'Tampered ciphertext correctly detected')
  }
}

/* ── Test 8: Wrong DEK Detection ─────────────────────────────────── */

async function testWrongDEK() {
  console.log('\n🔒 Test 8: Wrong DEK Detection')
  const dek1 = generateFileDEK()
  const dek2 = generateFileDEK()
  const plaintext = crypto.randomBytes(10000)
  const ciphertext = await encryptBuffer(plaintext, dek1)

  try {
    await decryptBuffer(ciphertext, dek2)
    assert(false, 'Wrong DEK should fail decryption')
  } catch {
    assert(true, 'Wrong DEK correctly rejected')
  }
}

/* ── Run All Tests ───────────────────────────────────────────────── */

async function main() {
  console.log('🔐 9Drive File Encryption Test Suite\n' + '═'.repeat(50))

  await testDEKEnvelope()
  await testRoundtrip()
  await testHeaderParsing()
  await testSizeCalculation()
  await testRangeMapping()
  await testSingleChunkDecrypt()
  await testTamperDetection()
  await testWrongDEK()

  console.log('\n' + '═'.repeat(50))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('❌ SOME TESTS FAILED')
    process.exit(1)
  } else {
    console.log('✅ ALL TESTS PASSED')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
