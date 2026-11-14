import type { NextFunction, Request, Response } from 'express'

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error('[request-error]', error instanceof Error ? error.message : error)
  if (error && typeof error === 'object' && 'issues' in error) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Request validation failed.' })
  }
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' })
}
