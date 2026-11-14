import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  aboutGet: vi.fn(),
  accountFind: vi.fn(),
  accountUpdate: vi.fn(),
  configFind: vi.fn(),
  quotaUpsert: vi.fn(),
}))

vi.mock('../../utils/crypto.js', () => ({
  decryptText: (value: string) => value,
  encryptText: (value: string) => value,
}))
vi.mock('../../config/prisma.js', () => ({
  prisma: {
    providerConfig: { findUniqueOrThrow: mocks.configFind },
    connectedAccount: { findUniqueOrThrow: mocks.accountFind, update: mocks.accountUpdate },
    storageAccount: { upsert: mocks.quotaUpsert },
  },
}))
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        refreshAccessToken = mocks.refreshAccessToken
      },
    },
    drive: () => ({ about: { get: mocks.aboutGet } }),
  },
}))

describe('mocked Google Drive provider behavior', () => {
  let syncGoogleQuota: typeof import('./google.service.js').syncGoogleQuota

  beforeAll(async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/9drive'
    process.env.FRONTEND_URL = 'http://localhost:5173'
    process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-that-is-at-least-32-chars'
    process.env.TOKEN_ENCRYPTION_KEY = 'test-token-encryption-key-that-is-long'
    const service = await import('./google.service.js')
    syncGoogleQuota = service.syncGoogleQuota
  })

  it('refreshes an expired account token and persists Drive quota', async () => {
    mocks.configFind.mockResolvedValue({ clientIdEncrypted: 'client', clientSecretEncrypted: 'secret', redirectUri: 'http://localhost/callback' })
    mocks.accountFind.mockResolvedValue({ id: 'account-1', providerConfigId: 'config-1', accessTokenEncrypted: 'access', refreshTokenEncrypted: 'refresh', tokenExpiresAt: new Date(Date.now() - 60_000) })
    mocks.refreshAccessToken.mockResolvedValue({ credentials: { access_token: 'new-access', expiry_date: Date.now() + 3_600_000 } })
    mocks.aboutGet.mockResolvedValue({ data: { storageQuota: { limit: '1000', usage: '250', usageInDriveTrash: '10' } } })
    mocks.quotaUpsert.mockResolvedValue({ connectedAccountId: 'account-1', totalBytes: 1000n, usedBytes: 250n, availableBytes: 750n })

    const result = await syncGoogleQuota('account-1')

    expect(mocks.refreshAccessToken).toHaveBeenCalledOnce()
    expect(mocks.aboutGet).toHaveBeenCalledOnce()
    expect(mocks.quotaUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { connectedAccountId: 'account-1' } }))
    expect(result.usedBytes).toBe(250n)
  })
})
