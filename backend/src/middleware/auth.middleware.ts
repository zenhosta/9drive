import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../config/prisma.js'
import { verifyAccessToken } from '../utils/jwt.js'

export type AuthRequest = Request & {
  user?: { id: string; sessionId: string }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.header('Authorization')
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Bearer token required.' })
    const payload = verifyAccessToken(header.slice(7))
    const session = await prisma.userSession.findUnique({ where: { id: payload.sid } })
    if (!session || session.revokedAt || session.expiresAt < new Date()) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Session expired.' })
    req.user = { id: payload.sub, sessionId: payload.sid }
    return next()
  } catch {
    return res.status(401).json({ code: 'AUTH_INVALID_TOKEN', message: 'Invalid token.' })
  }
}

// Use after requireAuth. Instance-wide settings and maintenance actions are admin-only.
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = req.user ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, status: true } }) : null
    if (!user || user.status !== 'active' || user.role !== 'admin') return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
    return next()
  } catch (error) {
    return next(error)
  }
}
