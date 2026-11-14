import { beforeAll, describe, expect, it } from 'vitest'

let encryptText: (value: string) => string
let decryptText: (value: string) => string
let hashToken: (value: string) => string

beforeAll(async () => {
  process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/9drive'
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-that-is-at-least-32-chars'
  process.env.TOKEN_ENCRYPTION_KEY = 'test-token-encryption-key-that-is-long'
  const crypto = await import('./crypto.js')
  encryptText = crypto.encryptText
  decryptText = crypto.decryptText
  hashToken = crypto.hashToken
})

describe('crypto helpers', () => {
  it('round-trips encrypted credentials without returning plaintext', () => {
    const encrypted = encryptText('refresh-token-value')
    expect(encrypted).not.toContain('refresh-token-value')
    expect(decryptText(encrypted)).toBe('refresh-token-value')
  })

  it('uses a fresh nonce and deterministic token hashes', () => {
    expect(encryptText('same-value')).not.toBe(encryptText('same-value'))
    expect(hashToken('same-value')).toBe(hashToken('same-value'))
  })
})