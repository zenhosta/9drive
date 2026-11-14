import type { NextFunction, Request, Response } from 'express'

/** Google refused a drive's stored login (revoked, password changed, or a 7-day token from an OAuth app in Testing mode). */
export function isGoogleAuthError(error: unknown) {
  const e = error as { message?: string; response?: { data?: { error?: string } } }
  return /invalid_grant|invalid_rapt|Token has been expired or revoked/i.test(`${e?.message ?? ''} ${e?.response?.data?.error ?? ''}`)
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  // 409, not 401: a 401 would make the frontend think the user's own 9Drive session ended.
  if (isGoogleAuthError(error)) {
    return res.status(409).json({ code: 'DRIVE_NEEDS_RECONNECT', message: 'Google sign-in for a drive has expired. Reconnect your drives in Settings.' })
  }
  const message = error instanceof Error ? error.message : 'Internal server error'
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message })
}
