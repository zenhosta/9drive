import { backoffDelayMs, classifyDriveError } from '../jobs/move-logic.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Retries transient Google errors (429, 5xx, rate-limit 403s, network resets) with exponential backoff. */
export async function withBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      const c = classifyDriveError(error)
      if (!c.retryable || attempt >= maxRetries) throw error
      console.info('[google] retrying after transient error', { attempt: attempt + 1, status: c.status, reason: c.reason })
      await sleep(backoffDelayMs(attempt))
    }
  }
}
