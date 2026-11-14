import type { NextFunction, Request, Response } from 'express'
import { parse } from 'cookie'
import { prisma } from '../config/prisma.js'
import { verifyAccessToken } from '../utils/jwt.js'
import { accessCookieName } from '../utils/session-cookies.js'

export type AuthRequest = Request & {
  user?: { id: string; sessionId: string }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.header('Authorization')
    const cookieToken = parse(req.headers.cookie ?? '')[accessCookieName]
    const rawToken = cookieToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : null)
    if (!rawToken) return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Authentication required.' })
    const payload = verifyAccessToken(rawToken)
    const session = await prisma.userSession.findUnique({ where: { id: payload.sid }, include: { user: { select: { status: true } } } })
    if (!session || session.revokedAt || session.expiresAt < new Date()) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Session expired.' })
    if (session.user.status !== 'active') return res.status(403).json({ code: 'AUTH_ACCOUNT_DISABLED', message: 'Account is disabled.' })
    req.user = { id: payload.sub, sessionId: payload.sid }
    return next()
  } catch {
    return res.status(401).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid token.' })
  }
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await requireAuth(req, res, async () => {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { role: true, email: true } })
      const configuredEmails = process.env.ADMIN_EMAILS?.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean) ?? []
      if (user?.role !== 'admin' && !configuredEmails.includes(user?.email.toLowerCase() ?? '')) {
        return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
      }
      return next()
    })
  } catch {
    return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
  }
}
