import crypto from 'node:crypto'
import type { Response } from 'express'
import { serialize } from 'cookie'
import { env } from '../config/env.js'

export const accessCookieName = '9drive.access'
export const refreshCookieName = '9drive.refresh'
export const csrfCookieName = '9drive.csrf'

const secure = env.COOKIE_SECURE
const baseCookie = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' }

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const csrfToken = cryptoRandomToken()
  res.setHeader('Set-Cookie', [
    serialize(accessCookieName, accessToken, { ...baseCookie, maxAge: env.ACCESS_TOKEN_TTL_SECONDS }),
    serialize(refreshCookieName, refreshToken, { ...baseCookie, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 }),
    serialize(csrfCookieName, csrfToken, { secure, sameSite: 'lax', path: '/', maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 }),
  ])
}

export function clearAuthCookies(res: Response) {
  res.setHeader('Set-Cookie', [
    serialize(accessCookieName, '', { ...baseCookie, maxAge: 0 }),
    serialize(refreshCookieName, '', { ...baseCookie, maxAge: 0 }),
    serialize(csrfCookieName, '', { secure, sameSite: 'lax', path: '/', maxAge: 0 }),
  ])
}

function cryptoRandomToken() {
  return crypto.randomBytes(32).toString('base64url')
}
