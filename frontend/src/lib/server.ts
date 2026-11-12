import { Capacitor } from '@capacitor/core'

const STORAGE_KEY = '9drive:api-url'
const buildTimeApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim()

export const isNativeApp = () => Capacitor.isNativePlatform()

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

/**
 * Resolves the API base URL, preferring the server the user picked on the
 * device, then the URL baked in at build time. Returns null when no server is
 * known yet (the Android app then shows the server setup screen).
 */
export function getConfiguredApiUrl(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return normalizeUrl(stored)
  if (buildTimeApiUrl && buildTimeApiUrl !== 'http://localhost:4000') return normalizeUrl(buildTimeApiUrl)
  return null
}

export function setConfiguredApiUrl(value: string) {
  localStorage.setItem(STORAGE_KEY, normalizeUrl(value))
}

export function clearConfiguredApiUrl() {
  localStorage.removeItem(STORAGE_KEY)
}

export function isValidServerUrl(value: string) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.host)
  } catch {
    return false
  }
}

export function needsServerSetup() {
  return isNativeApp() && !getConfiguredApiUrl()
}
