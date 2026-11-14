import { describe, expect, it, vi } from 'vitest'
import { cleanupFailedUpload } from './upload-cleanup.js'

describe('failed upload cleanup', () => {
  it('marks the session failed even when provider cleanup errors', async () => {
    const sessionCleanup = vi.fn().mockResolvedValue(undefined)
    const providerCleanup = vi.fn().mockRejectedValue(new Error('provider unavailable'))

    await cleanupFailedUpload(providerCleanup, sessionCleanup)

    expect(providerCleanup).toHaveBeenCalledOnce()
    expect(sessionCleanup).toHaveBeenCalledOnce()
  })

  it('supports provider errors before a provider object exists', async () => {
    const sessionCleanup = vi.fn().mockResolvedValue(undefined)
    await cleanupFailedUpload(null, sessionCleanup)
    expect(sessionCleanup).toHaveBeenCalledOnce()
  })
})