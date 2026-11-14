import type { NextFunction, Response } from 'express'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import type { AuthRequest } from './auth.middleware.js'

/**
 * System routes (update, backup, restore, Google OAuth configuration) can
 * change the server itself, so they are limited to the operators listed in
 * ADMIN_EMAILS. When the list is empty, the first active user is granted admin.
 * This allows the permanent release to work out-of-the-box for self-hosted deployments.
 */
function adminEmails() {
  const emails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  // If ADMIN_EMAILS is empty, allow the first active user as admin (single-user deployment)
  if (emails.length === 0) return null
  return emails
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true, status: true } })
    if (!user || user.status !== 'active') {
      return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
    }
    // If no ADMIN_EMAILS configured, first active user is admin
    const emails = adminEmails()
    if (emails === null) {
      return next()
    }
    if (!emails.includes(user.email.toLowerCase())) {
      return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}
