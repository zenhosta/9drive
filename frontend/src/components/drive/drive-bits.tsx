import { API_URL } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { categoryStyle, type CategoryKey } from '@/lib/file-types'
import { cn } from '@/lib/utils'

const badgeTones = ['bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-800', 'bg-pink-100 text-pink-700', 'bg-cyan-100 text-cyan-700', 'bg-lime-100 text-lime-800']

/** Stable colour per drive so the same drive always looks the same. */
export function badgeTone(accountId: string) {
  let hash = 0
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return badgeTones[hash % badgeTones.length]
}

export const driveName = (a: { email: string }) => a.email.split('@')[0]

export function TypeIcon({ category, className }: { category: CategoryKey; className?: string }) {
  const { icon: Icon, tone } = categoryStyle[category]
  return <span className={cn('flex shrink-0 items-center justify-center rounded-lg', tone, className)}><Icon className="h-1/2 w-1/2" aria-hidden /></span>
}

export function authedFetch(path: string) {
  return fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
}

export async function downloadIndexedFile(id: string, name: string) {
  const r = await authedFetch(`/drive-index/${id}/download`)
  if (!r.ok) throw new Error('Download failed')
  const url = URL.createObjectURL(await r.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export type IndexedRow = {
  id: string
  providerFileId: string
  name: string
  mimeType: string
  sizeBytes: string
  path: string
  modifiedAt: string | null
  connectedAccountId: string
  connectedAccount: { id: string; email: string; displayName: string | null; provider: string }
  category: CategoryKey
}

export const googleDriveLink = (row: IndexedRow) => `https://drive.google.com/file/d/${row.providerFileId}/view?authuser=${encodeURIComponent(row.connectedAccount.email)}`
