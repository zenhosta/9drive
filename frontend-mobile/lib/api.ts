import { getItem, setItem, deleteItem } from '@/lib/storage'

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'

async function getToken() {
  return await getItem('accessToken')
}

async function getRefreshToken() {
  return await getItem('refreshToken')
}

async function setTokens(access: string, refresh: string) {
  await setItem('accessToken', access)
  await setItem('refreshToken', refresh)
}

export async function clearSession() {
  await deleteItem('accessToken')
  await deleteItem('refreshToken')
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken()
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response = await fetch(`${API_URL}${path}`, { ...options, headers })

  // auto refresh kalau 401
  if (response.status === 401) {
    const refreshToken = await getRefreshToken()
    if (refreshToken) {
      const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        await setTokens(data.accessToken, data.refreshToken ?? refreshToken)
        headers.set('Authorization', `Bearer ${data.accessToken}`)
        response = await fetch(`${API_URL}${path}`, { ...options, headers })
      } else {
        await clearSession()
        throw new Error('Session expired')
      }
    }
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }

  // handle response kosong (204) atau bukan JSON
  const contentType = response.headers.get('content-type')
  if (response.status === 204 || !contentType?.includes('application/json')) {
    return undefined as T
  }
  return response.json()
}

export async function login(email: string, password: string) {
  const data = await apiFetch<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  await setTokens(data.accessToken, data.refreshToken)
  return data
}

export async function register(name: string, email: string, password: string) {
  const data = await apiFetch<{ accessToken: string; refreshToken: string; user: any }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })
  await setTokens(data.accessToken, data.refreshToken)
  return data
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}
