import { env } from '../config/env.js'

/**
 * Returns FRONTEND_URL guaranteed without trailing slashes.
 * Prevents double-slash URL issues in OAuth redirects and public share links.
 */
export function getFrontendUrl(): string {
  return env.FRONTEND_URL.replace(/\/+$/, '')
}
