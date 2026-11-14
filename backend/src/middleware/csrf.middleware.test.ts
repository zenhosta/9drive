import { beforeAll, describe, expect, it, vi } from 'vitest'

let csrfMiddleware: typeof import('./csrf.middleware.js').csrfMiddleware

beforeAll(async () => {
  process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/9drive'
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-that-is-at-least-32-chars'
  process.env.TOKEN_ENCRYPTION_KEY = 'test-token-encryption-key-that-is-long'
  csrfMiddleware = (await import('./csrf.middleware.js')).csrfMiddleware
})

function response() {
  const res = {
    append: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  }
  res.status.mockReturnValue(res)
  return res
}

function request(path: string, headers: Record<string, string>) {
  return { method: 'POST', path, headers, header: (name: string) => headers[name.toLowerCase()] ?? headers[name] }
}

describe('csrfMiddleware', () => {
  it('allows the unauthenticated login bootstrap', () => {
    const next = vi.fn()
    csrfMiddleware({ method: 'POST', path: '/login', headers: {} } as any, response() as any, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects unsafe cookie-authenticated requests without a matching header', () => {
    const res = response()
    csrfMiddleware(request('/files', { cookie: '9drive.csrf=expected' }) as any, res as any, vi.fn())
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('accepts a matching double-submit token', () => {
    const next = vi.fn()
    csrfMiddleware(request('/files', { cookie: '9drive.csrf=expected', 'x-csrf-token': 'expected' }) as any, response() as any, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
