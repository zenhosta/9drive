import { Prisma } from '@prisma/client'
import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../utils/http-error.js'

// Express body parsers mark client mistakes with `expose`. Google API errors also carry a
// `status`, so it can't be trusted alone.
function clientErrorStatus(error: unknown) {
  if (typeof error !== 'object' || error === null) return null
  const { status, expose } = error as { status?: unknown; expose?: unknown }
  return expose === true && typeof status === 'number' && status >= 400 && status < 500 ? status : null
}

export function errorMiddleware(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(error)

  if (error instanceof HttpError) return res.status(error.status).json({ code: error.code, message: error.message })

  if (error instanceof ZodError) {
    const issue = error.issues[0]
    const field = issue?.path.join('.')
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: field ? `${field}: ${issue?.message}` : issue?.message ?? 'Invalid request.' })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Resource not found.' })
  }

  const clientStatus = clientErrorStatus(error)
  if (clientStatus) {
    return res.status(clientStatus).json({ code: 'INVALID_REQUEST', message: clientStatus === 413 ? 'Request body is too large.' : 'Invalid request.' })
  }

  // Log the route pattern, not the URL: share and preview URLs contain tokens.
  console.error(`Unhandled error on ${req.method} ${req.route?.path ?? 'unknown route'}:`, error instanceof Error ? error.stack : error)
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' })
}
