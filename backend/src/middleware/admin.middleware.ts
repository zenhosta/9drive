import type { NextFunction, Response } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import type { AuthRequest } from './auth.middleware.js'

function adminEmails() {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * System routes (update, backup, restore, Google OAuth configuration) can
 * change the server itself, so they are limited to the operators listed in
 * ADMIN_EMAILS. When the list is empty every request is denied.
 */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true, status: true } })
    if (!user || user.status !== 'active' || !adminEmails().includes(user.email.toLowerCase())) {
      return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}
