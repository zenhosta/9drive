import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api'

describe('cookie-authenticated API requests', () => {
  beforeEach(() => {
    document.cookie = '9drive.csrf=csrf-test'
    vi.restoreAllMocks()
  })

  it('sends credentials and CSRF headers for account-management mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await apiFetch('/connected-accounts/example', { method: 'DELETE' })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.credentials).toBe('include')
    expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('csrf-test')
    expect(new Headers(options.headers).get('Authorization')).toBeNull()
  })
})