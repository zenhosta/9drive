import { describe, expect, it, vi } from 'vitest'
import { rateLimit } from './rate-limit.middleware.js'

function response() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  }
  res.status.mockReturnValue(res)
  return res
}

describe('rateLimit', () => {
  it('allows requests within the window and rejects excess requests', () => {
    const middleware = rateLimit(`test-${Date.now()}`, 2, 60_000)
    const req = { ip: `127.0.0.${Date.now() % 255}` } as any
    const next = vi.fn()
    const first = response()
    const second = response()
    const third = response()

    middleware(req, first as any, next)
    middleware(req, second as any, next)
    middleware(req, third as any, next)

    expect(next).toHaveBeenCalledTimes(2)
    expect(third.status).toHaveBeenCalledWith(429)
    expect(third.json).toHaveBeenCalledWith({ code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' })
  })
})