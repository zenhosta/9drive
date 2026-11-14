import { env } from '../config/env.js'

/**
 * Sends the browser back to the web app, or to the Android app's deep link
 * when the OAuth flow was started from the mobile client.
 */
export function frontendRedirect(path: string, mobile: boolean) {
  if (mobile && env.MOBILE_APP_REDIRECT_URL) {
    return `${env.MOBILE_APP_REDIRECT_URL.replace(/\/+$/, '')}${path}`
  }
  return `${env.FRONTEND_URL}${path}`
}
