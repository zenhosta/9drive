import { beforeEach, describe, expect, it } from 'vitest'
import { clearAuthSession, getStoredUser, setAuthSession } from './auth'

describe('browser authentication storage', () => {
  beforeEach(() => localStorage.clear())

  it('stores only the non-sensitive cached user profile', () => {
    setAuthSession({ id: 'user-1', name: 'Test User', email: 'test@example.test' })
    expect(getStoredUser()?.email).toBe('test@example.test')
    expect(localStorage.getItem('9drive.accessToken')).toBeNull()
    expect(localStorage.getItem('9drive.refreshToken')).toBeNull()
  })

  it('clears the cached profile without attempting to manage tokens', () => {
    setAuthSession({ id: 'user-1', name: 'Test User', email: 'test@example.test' })
    clearAuthSession()
    expect(getStoredUser()).toBeNull()
  })
})