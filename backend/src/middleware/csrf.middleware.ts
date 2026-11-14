import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { parse, serialize } from 'cookie'
import { csrfCookieName } from '../utils/session-cookies.js'
import { env } from '../config/env.js'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  const cookies = parse(req.headers.cookie ?? '')
  if (!cookies[csrfCookieName]) {
    res.append('Set-Cookie', serialize(csrfCookieName, crypto.randomBytes(32).toString('base64url'), {
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    }))
  }

  if (req.path === '/login' || req.path === '/register' || req.path === '/google/exchange' || req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/google/exchange') return next()
  if (safeMethods.has(req.method) || req.header('Authorization')?.startsWith('Bearer ')) return next()
  const cookieToken = cookies[csrfCookieName]
  const headerToken = req.header('X-CSRF-Token')
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return res.status(403).json({ code: 'CSRF_INVALID', message: 'CSRF validation failed.' })
  }
  return next()
}