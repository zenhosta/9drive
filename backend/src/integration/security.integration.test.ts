import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { parse } from 'cookie'

const runIntegration = Boolean(process.env.TEST_DATABASE_URL)
const suite = describe.skipIf(!runIntegration)
const prefix = `security-test-${Date.now()}`

type Session = { cookies: string; csrf: string; userId?: string }
let app: typeof import('../app.js').app
let prisma: typeof import('../config/prisma.js').prisma
let encryptText: typeof import('../utils/crypto.js').encryptText
let hashToken: typeof import('../utils/crypto.js').hashToken
let randomToken: typeof import('../utils/crypto.js').randomToken
let request: typeof import('supertest')

function cookieHeader(response: { headers: Record<string, string | string[] | undefined> }) {
  const values = response.headers['set-cookie']
  return (Array.isArray(values) ? values : values ? [values] : []).map((value) => value.split(';', 1)[0]).join('; ')
}

function csrfFrom(cookies: string) {
  return parse(cookies)['9drive.csrf'] ?? ''
}

function withSession(session: Session, requestBuilder: any) {
  return requestBuilder.set('Cookie', session.cookies).set('X-CSRF-Token', session.csrf)
}

async function register(email: string): Promise<Session> {
  const response = await request(app).post('/auth/register').send({ name: 'Security Test', email, password: 'a-secure-test-password' })
  expect(response.status).toBe(201)
  const cookies = cookieHeader(response)
  return { cookies, csrf: csrfFrom(cookies) }
}

beforeAll(async () => {
  if (!runIntegration) return
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.JWT_ACCESS_SECRET = 'integration-jwt-secret-that-is-at-least-32-chars'
  process.env.TOKEN_ENCRYPTION_KEY = 'integration-token-encryption-key-is-long'
  process.env.NODE_ENV = 'test'
  process.env.COOKIE_SECURE = 'false'
  process.env.TRUST_PROXY = 'false'
  process.env.ADMIN_EMAILS = `${prefix}-admin@example.test`
  request = (await import('supertest')).default
  prisma = (await import('../config/prisma.js')).prisma
  encryptText = (await import('../utils/crypto.js')).encryptText
  hashToken = (await import('../utils/crypto.js')).hashToken
  randomToken = (await import('../utils/crypto.js')).randomToken
  app = (await import('../app.js')).app
})

afterAll(async () => {
  if (!runIntegration) return
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } })
    await prisma.$disconnect()
  }
})

suite('security integration', () => {
  it('isolates users and protects admin-only endpoints', async () => {
    const user = await register(`${prefix}-user@example.test`)
    const other = await register(`${prefix}-other@example.test`)
    const created = await withSession(user, request(app).post('/folders')).send({ name: 'Private folder' })
    expect(created.status).toBe(201)
    const otherFolders = await withSession(other, request(app).get('/folders'))
    expect(otherFolders.status).toBe(200)
    expect(otherFolders.body.folders).toHaveLength(0)
    expect((await withSession(user, request(app).get('/system/google-config'))).status).toBe(403)

    const admin = await register(`${prefix}-admin@example.test`)
    expect((await withSession(admin, request(app).get('/system/google-config'))).status).toBe(200)
  })

  it('rotates refresh cookies and detects reuse', async () => {
    const session = await register(`${prefix}-refresh@example.test`)
    const first = await withSession(session, request(app).post('/auth/refresh'))
    expect(first.status).toBe(200)
    const rotatedCookies = cookieHeader(first)
    const rotated = { cookies: rotatedCookies, csrf: csrfFrom(rotatedCookies) }
    expect(rotated.cookies).not.toBe(session.cookies)
    const reused = await withSession(session, request(app).post('/auth/refresh'))
    expect(reused.status).toBe(401)
    expect(reused.body.code).toBe('AUTH_REFRESH_TOKEN_REUSED')
    expect((await withSession(rotated, request(app).get('/auth/me'))).status).toBe(401)

    const legacy = await register(`${prefix}-legacy@example.test`)
    const legacyUser = await prisma.user.findUniqueOrThrow({ where: { email: `${prefix}-legacy@example.test` } })
    const legacyValue = randomToken()
    await prisma.userSession.create({ data: { userId: legacyUser.id, refreshTokenHash: hashToken(legacyValue), expiresAt: new Date(Date.now() + 60_000) } })
    const legacyCookies = `9drive.refresh=${legacyValue}; 9drive.csrf=legacy-csrf`
    const migrated = await withSession({ cookies: legacyCookies, csrf: 'legacy-csrf' }, request(app).post('/auth/refresh'))
    expect(migrated.status).toBe(200)
  })

  it('prevents OAuth state replay', async () => {
    const config = await prisma.providerConfig.create({ data: {
      provider: 'google_drive',
      clientIdEncrypted: encryptText('client-id'),
      clientSecretEncrypted: encryptText('client-secret'),
      redirectUri: 'http://localhost:4000/connected-accounts/google/callback',
      scopes: [],
    } })
    const state = randomToken()
    await prisma.oauthState.create({ data: { providerConfigId: config.id, flow: 'login', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 60_000) } })
    const first = await request(app).get(`/auth/google/callback?code=invalid&state=${state}`)
    const second = await request(app).get(`/auth/google/callback?code=invalid&state=${state}`)
    expect(first.status).toBe(302)
    expect(second.status).toBe(302)
    expect((await prisma.oauthState.findUnique({ where: { stateHash: hashToken(state) } }))?.usedAt).not.toBeNull()
  })

  it('creates and revokes an application public share', async () => {
    const session = await register(`${prefix}-share@example.test`)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `${prefix}-share@example.test` } })
    const account = await prisma.connectedAccount.create({ data: { userId: user.id, provider: 's3', providerAccountId: `${prefix}-s3`, email: `${prefix}@example.test`, scopes: [] } })
    const file = await prisma.file.create({ data: { userId: user.id, connectedAccountId: account.id, provider: 's3', providerFileId: `${prefix}-object`, name: 'private.txt', mimeType: 'text/plain', sizeBytes: 7n } })
    const shared = await withSession(session, request(app).post(`/files/${file.id}/share`))
    expect(shared.status).toBe(201)
    const token = shared.body.url.split('/').pop()
    expect((await request(app).get(`/public/files/${token}`)).status).toBe(200)
    expect((await withSession(session, request(app).delete(`/files/${file.id}/share`))).status).toBe(200)
    expect((await request(app).get(`/public/files/${token}`)).status).toBe(404)
  })
})
