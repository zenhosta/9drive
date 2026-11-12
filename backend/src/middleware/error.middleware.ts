import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? 'Invalid request.' })
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ code: error.code, message: error.message })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') return res.status(404).json({ code: 'NOT_FOUND', message: 'Resource not found.' })
    if (error.code === 'P2002') return res.status(409).json({ code: 'CONFLICT', message: 'Resource already exists.' })
  }

  // Log the detail, but never return internal messages (Prisma, filesystem,
  // provider errors) to the client.
  console.error('Unhandled request error:', error)
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' })
}
