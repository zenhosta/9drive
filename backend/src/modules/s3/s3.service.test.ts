import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => ({ done: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class {},
  HeadBucketCommand: class {},
  ListObjectsV2Command: class {},
}))
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    done = mocks.done
    constructor() {}
  },
}))
vi.mock('../../utils/crypto.js', () => ({ decryptText: (value: string) => value }))
vi.mock('../../config/prisma.js', () => ({ prisma: {} }))

describe('mocked S3 provider behavior', () => {
  let buildS3ObjectKey: typeof import('./s3.service.js').buildS3ObjectKey
  let uploadS3Object: typeof import('./s3.service.js').uploadS3Object

  beforeAll(async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/9drive'
    process.env.FRONTEND_URL = 'http://localhost:5173'
    process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-that-is-at-least-32-chars'
    process.env.TOKEN_ENCRYPTION_KEY = 'test-token-encryption-key-that-is-long'
    const service = await import('./s3.service.js')
    buildS3ObjectKey = service.buildS3ObjectKey
    uploadS3Object = service.uploadS3Object
  })

  it('builds isolated safe object keys', () => {
    expect(buildS3ObjectKey({ prefix: '/9drive/' }, 'user-1', 'file-1', '../private.txt')).toBe('9drive/user-1/file-1/..-private.txt')
  })

  it('propagates provider failures for the caller cleanup path', async () => {
    mocks.done.mockRejectedValueOnce(new Error('S3 unavailable'))
    await expect(uploadS3Object({} as any, 'key', Readable.from([]), 'text/plain')).rejects.toThrow('S3 unavailable')
  })
})
