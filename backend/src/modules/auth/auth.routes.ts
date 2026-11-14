import { Router } from 'express'
import { google } from 'googleapis'
import { parse } from 'cookie'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'
import { createOAuthClient, syncGoogleQuota } from '../google/google.service.js'
import { clearAuthCookies, refreshCookieName, setAuthCookies } from '../../utils/session-cookies.js'

export const authRouter = Router()

const registerSchema = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), captchaToken: z.string().optional() })
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
const refreshSchema = z.object({ refreshToken: z.string().min(1) })
const googleExchangeSchema = z.object({ token: z.string().min(1) })

async function createSession(userId: string, req: AuthRequest) {
  const refreshToken = randomToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: req.header('User-Agent'),
      ipAddress: req.ip,
      expiresAt,
    },
  })
  await prisma.refreshToken.create({ data: { sessionId: session.id, tokenHash: hashToken(refreshToken) } })
  return { accessToken: signAccessToken({ sub: userId, sid: session.id }), refreshToken }
}

async function verifyCaptcha(token: string | undefined) {
  if (!env.RECAPTCHA_SECRET_KEY) return true
  if (!token) return false
  const form = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: token })
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: form })
  const data = await response.json() as { success?: boolean }
  return Boolean(data.success)
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body)
    if (!(await verifyCaptcha(body.captchaToken))) return res.status(400).json({ code: 'CAPTCHA_FAILED', message: 'Captcha verification failed.' })
    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    if (existing) return res.status(409).json({ code: 'AUTH_EMAIL_TAKEN', message: 'Email already registered.' })
    const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password) } })
    const tokens = await createSession(user.id, req)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken)
    return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) return res.status(401).json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password.' })
    const tokens = await createSession(user.id, req)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken)
    return res.json({ user: { id: user.id, name: user.name, email: user.email } })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/url', async (_req, res, next) => {
  try {
    const config = await prisma.providerConfig.findFirstOrThrow({ where: { userId: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
    const state = randomToken()
    await prisma.oauthState.create({ data: { providerConfigId: config.id, flow: 'login', stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const client = createOAuthClient(config)
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: config.scopes as string[],
      state,
    })
    return res.json({ url })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/callback', async (req, res) => {
  try {
    const query = z.object({ code: z.string(), state: z.string() }).parse(req.query)
    const oauthState = await prisma.oauthState.findUniqueOrThrow({ where: { stateHash: hashToken(query.state) }, include: { providerConfig: true } })
    if (oauthState.flow !== 'login' || oauthState.usedAt || oauthState.expiresAt < new Date()) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
    const claimedState = await prisma.oauthState.updateMany({ where: { id: oauthState.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
    if (claimedState.count !== 1) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)

    const client = createOAuthClient(oauthState.providerConfig)
    const tokenResult = await client.getToken(query.code)
    const tokens = tokenResult.tokens
    if (!tokens.access_token) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
    client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const profile = await oauth2.userinfo.get()
    const providerAccountId = profile.data.id
    const email = profile.data.email
    if (!providerAccountId || !email) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)

    const name = profile.data.name || email.split('@')[0] || 'Google User'
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash: await hashPassword(randomToken(32)) },
      update: { name },
    })
    const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } } })
    const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existingAccount?.refreshTokenEncrypted
    if (!refreshTokenEncrypted) return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)

    const account = await prisma.connectedAccount.upsert({
      where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } },
      create: {
        userId: user.id,
        providerConfigId: oauthState.providerConfigId,
        provider: 'google_drive',
        providerAccountId,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(tokens.access_token),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: oauthState.providerConfig.scopes as string[],
        status: 'connected',
      },
      update: {
        providerConfigId: oauthState.providerConfigId,
        email,
        displayName: profile.data.name,
        avatarUrl: profile.data.picture,
        accessTokenEncrypted: encryptText(tokens.access_token),
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: oauthState.providerConfig.scopes as string[],
        status: 'connected',
      },
    })

    await prisma.oauthState.update({ where: { id: oauthState.id }, data: { userId: user.id } })
    await syncGoogleQuota(account.id).catch(() => undefined)

    const handoffToken = randomToken()
    await prisma.authHandoff.create({ data: { userId: user.id, tokenHash: hashToken(handoffToken), expiresAt: new Date(Date.now() + 5 * 60_000) } })
    return res.redirect(`${env.FRONTEND_URL}/google-auth?token=${handoffToken}`)
  } catch (error) {
    console.error('Google Auth callback failed:', error)
    return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
  }
})

authRouter.post('/google/exchange', async (req, res, next) => {
  try {
    const body = googleExchangeSchema.parse(req.body)
    const handoff = await prisma.authHandoff.findFirst({ where: { tokenHash: hashToken(body.token), usedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } })
    if (!handoff) return res.status(401).json({ code: 'AUTH_GOOGLE_HANDOFF_INVALID', message: 'Google login session expired.' })
    await prisma.authHandoff.update({ where: { id: handoff.id }, data: { usedAt: new Date() } })
    const tokens = await createSession(handoff.userId, req)
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken)
    return res.json({ user: { id: handoff.user.id, name: handoff.user.name, email: handoff.user.email } })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const body = refreshSchema.partial().parse(req.body ?? {})
    const refreshTokenValue = body.refreshToken ?? parse(req.headers.cookie ?? '')[refreshCookieName]
    if (!refreshTokenValue) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Refresh token expired.' })
    const tokenHash = hashToken(refreshTokenValue)
    const result = await prisma.$transaction(async (tx) => {
      const refreshToken = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } })
      if (!refreshToken) {
        const legacySession = await tx.userSession.findFirst({ where: { refreshTokenHash: tokenHash, revokedAt: null, expiresAt: { gt: new Date() } } })
        if (!legacySession) return { status: 'invalid' as const }
        const replacement = randomToken()
        await tx.refreshToken.create({ data: { sessionId: legacySession.id, tokenHash, usedAt: new Date() } })
        await tx.refreshToken.create({ data: { sessionId: legacySession.id, tokenHash: hashToken(replacement) } })
        return { status: 'ok' as const, userId: legacySession.userId, sessionId: legacySession.id, refreshToken: replacement }
      }
      if (refreshToken.usedAt || refreshToken.revokedAt) {
        await tx.refreshToken.updateMany({ where: { sessionId: refreshToken.sessionId, revokedAt: null }, data: { revokedAt: new Date() } })
        await tx.userSession.update({ where: { id: refreshToken.sessionId }, data: { revokedAt: new Date() } })
        return { status: 'reused' as const }
      }
      if (refreshToken.session.revokedAt || refreshToken.session.expiresAt <= new Date()) return { status: 'expired' as const }

      const replacement = randomToken()
      const marked = await tx.refreshToken.updateMany({ where: { id: refreshToken.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } })
      if (marked.count !== 1) {
        await tx.refreshToken.updateMany({ where: { sessionId: refreshToken.sessionId, revokedAt: null }, data: { revokedAt: new Date() } })
        await tx.userSession.update({ where: { id: refreshToken.sessionId }, data: { revokedAt: new Date() } })
        return { status: 'reused' as const }
      }
      await tx.refreshToken.create({ data: { sessionId: refreshToken.sessionId, tokenHash: hashToken(replacement) } })
      return { status: 'ok' as const, userId: refreshToken.session.userId, sessionId: refreshToken.sessionId, refreshToken: replacement }
    })

    if (result.status !== 'ok') return res.status(401).json({ code: result.status === 'reused' ? 'AUTH_REFRESH_TOKEN_REUSED' : 'AUTH_SESSION_EXPIRED', message: 'Refresh token is no longer valid.' })
    const accessToken = signAccessToken({ sub: result.userId, sid: result.sessionId })
    setAuthCookies(res, accessToken, result.refreshToken)
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/logout', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await prisma.userSession.update({ where: { id: req.user!.sessionId }, data: { revokedAt: new Date() } })
    await prisma.refreshToken.updateMany({ where: { sessionId: req.user!.sessionId, revokedAt: null }, data: { revokedAt: new Date() } })
    clearAuthCookies(res)
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, status: true } })
    return res.json({ user })
  } catch (error) {
    return next(error)
  }
})
