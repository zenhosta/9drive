import type { NextFunction, Request, Response } from 'express'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export function rateLimit(name: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = `${name}:${req.ip}`
    const current = buckets.get(key)
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (current.count >= limit) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000))
      return res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' })
    }
    current.count += 1
    return next()
  }
}

setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}, 60_000).unref()
