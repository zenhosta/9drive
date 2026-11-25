import { useEffect, useRef, useState } from 'react'
import { LayoutGrid, List, MoreVertical, type LucideIcon } from 'lucide-react'
import { API_URL } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { categoryStyle, type CategoryKey } from '@/lib/file-types'
import { cn } from '@/lib/utils'

/** Stable colour class per drive (see .tag-c0..c6 in style.css, readable in light and dark). */
export function badgeTone(accountId: string) {
  let hash = 0
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return `tag tag-c${hash % 7}`
}

export const driveName = (a: { email: string }) => a.email.split('@')[0]

export function TypeIcon({ category, className }: { category: CategoryKey; className?: string }) {
  const { icon: Icon, tone } = categoryStyle[category]
  return <span className={cn('on-accent flex shrink-0 items-center justify-center rounded-lg', tone, className)}><Icon className="h-1/2 w-1/2" aria-hidden /></span>
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

// Thumbnails come from Drive's own previews (photos, videos, PDFs, documents...), fetched a few at a time and cached.
const thumbCache = new Map<string, string | null>()
const thumbWaiting: Array<() => void> = []
let thumbActive = 0
const THUMB_PARALLEL = 4

function acquireThumbSlot() {
  return new Promise<void>((resolve) => {
    const start = () => { thumbActive += 1; resolve() }
    if (thumbActive < THUMB_PARALLEL) start(); else thumbWaiting.push(start)
  })
}
function releaseThumbSlot() {
  thumbActive -= 1
  thumbWaiting.shift()?.()
}

async function loadThumb(id: string): Promise<string | null> {
  if (thumbCache.has(id)) return thumbCache.get(id) ?? null
  await acquireThumbSlot()
  try {
    if (thumbCache.has(id)) return thumbCache.get(id) ?? null
    const r = await authedFetch(`/drive-index/${id}/thumb`)
    const url = r.ok ? URL.createObjectURL(await r.blob()) : null
    thumbCache.set(id, url)
    return url
  } catch {
    return null
  } finally {
    releaseThumbSlot()
  }
}

/** Preview image that loads only when scrolled into view. `small` is the compact version used in list rows. */
export function Thumb({ file, small = false }: { file: IndexedRow; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(thumbCache.get(file.id) ?? null)
  useEffect(() => {
    if (src) return undefined
    const node = ref.current
    if (!node || thumbCache.get(file.id) === null) return undefined
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      loadThumb(file.id).then((url) => { if (!cancelled && url) setSrc(url) })
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => { cancelled = true; observer.disconnect() }
  }, [file.id, src])
  return (
    <div ref={ref} className={cn('flex items-center justify-center overflow-hidden bg-slate-100', small ? 'h-8 w-8 shrink-0 rounded-lg' : 'aspect-[4/3] w-full rounded-xl')}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" onError={() => { thumbCache.set(file.id, null); setSrc(null) }} /> : <TypeIcon category={file.category} className={small ? 'h-8 w-8' : 'h-14 w-14'} />}
    </div>
  )
}

/** Clearly labelled List / Grid switch. */
export function ViewToggle({ view, onChange }: { view: 'list' | 'grid'; onChange: (v: 'list' | 'grid') => void }) {
  const base = 'seg-btn inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
  return (
    <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-xl border border-slate-300">
      <button type="button" aria-pressed={view === 'list'} onClick={() => onChange('list')} className={cn(base, view === 'list' ? 'seg-on' : '')}><List className="h-4 w-4" aria-hidden />List</button>
      <button type="button" aria-pressed={view === 'grid'} onClick={() => onChange('grid')} className={cn(base, 'border-l border-slate-300', view === 'grid' ? 'seg-on' : '')}><LayoutGrid className="h-4 w-4" aria-hidden />Grid</button>
    </div>
  )
}

export type MenuAction = { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean; href?: string }

/** The "⋯" actions menu on every file and folder row: move, copy, delete, download. */
export function RowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><MoreVertical className="h-4 w-4" aria-hidden /></button>
      {open ? (
        <div role="menu" className="menu-pop absolute right-0 z-30 mt-1 w-52 rounded-xl p-1">
          {actions.map((a) => {
            const cls = cn('menu-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold', a.danger && 'menu-danger')
            return a.href
              ? <a key={a.label} role="menuitem" className={cls} href={a.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><a.icon className="h-4 w-4" aria-hidden />{a.label}</a>
              : <button key={a.label} role="menuitem" type="button" className={cls} onClick={() => { setOpen(false); a.onClick() }}><a.icon className="h-4 w-4" aria-hidden />{a.label}</button>
          })}
        </div>
      ) : null}
    </div>
  )
}
