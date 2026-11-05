import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRightLeft, ChevronLeft, ChevronRight, Download, Edit3, LayoutGrid, List, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { MoveToDriveDialog } from '@/components/drive/MoveToDriveDialog'
import { PageHeader } from '@/components/drive/PageHeader'
import { useJobs } from '@/context/JobsContext'
import { API_URL, apiFetch, formatBytes, formatDate } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { categoryStyle, isCategoryKey, type CategoryKey } from '@/lib/file-types'
import { cn } from '@/lib/utils'

type FileRow = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  createdAt: string
  connectedAccountId: string
  connectedAccount: { id: string; email: string; displayName: string | null; provider: string }
  folder: { id: string; name: string } | null
  category: CategoryKey
}
type ListResponse = { page: number; pageSize: number; total: number; totalPages: number; files: FileRow[] }
type Summary = { total: { count: number; sizeBytes: string }; categories: Array<{ key: CategoryKey; label: string; count: number; sizeBytes: string }> }
type Account = { id: string; email: string; displayName: string | null; provider: string }
type View = 'list' | 'grid'

const PAGE_SIZE = 50
const THUMB_MAX_BYTES = 8 * 1024 * 1024
const viewKey = '9drive:files-by-type-view'
const badgeTones = ['bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-800', 'bg-pink-100 text-pink-700', 'bg-cyan-100 text-cyan-700']

function badgeTone(accountId: string) {
  let hash = 0
  for (const ch of accountId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return badgeTones[hash % badgeTones.length]
}

function shortDrive(file: FileRow) {
  return file.connectedAccount.email.split('@')[0]
}

function TypeIcon({ category, className }: { category: CategoryKey; className?: string }) {
  const { icon: Icon, tone } = categoryStyle[category]
  return <span className={cn('flex shrink-0 items-center justify-center rounded-lg', tone, className)}><Icon className="h-1/2 w-1/2" aria-hidden /></span>
}

/** Mounts the media element only once the card scrolls into view, so a page of 50 doesn't fetch 50 files at once. */
function Thumb({ file, src }: { file: FileRow; src?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const canThumb = Boolean(src) && !failed && Number(file.sizeBytes) <= THUMB_MAX_BYTES && (file.category === 'images' || file.category === 'videos')
  return (
    <div ref={ref} className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
      {canThumb && visible && file.category === 'images' ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : null}
      {canThumb && visible && file.category === 'videos' ? <video src={`${src}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" onError={() => setFailed(true)} /> : null}
      {!(canThumb && visible) ? <TypeIcon category={file.category} className="h-14 w-14" /> : null}
    </div>
  )
}

export function FilesByTypePage() {
  const [params, setParams] = useSearchParams()
  const { finishedVersion } = useJobs()
  const category = (isCategoryKey(params.get('type')) ? params.get('type') : 'all') as CategoryKey | 'all'
  const accountId = params.get('drive') ?? ''
  const q = params.get('q') ?? ''
  const sort = (['name', 'size', 'date'].includes(params.get('sort') ?? '') ? params.get('sort') : 'date') as 'name' | 'size' | 'date'
  const order = params.get('order') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)

  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(viewKey) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const [searchText, setSearchText] = useState(q)
  const [data, setData] = useState<ListResponse | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Map<string, FileRow>>(new Map())
  const [moveOpen, setMoveOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)

  const setParam = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    apiFetch<{ accounts: Account[] }>('/connected-accounts').then((r) => setAccounts(r.accounts)).catch(() => undefined)
  }, [])

  // Debounce the search box into the URL.
  useEffect(() => {
    if (searchText === q) return undefined
    const t = window.setTimeout(() => setParam({ q: searchText.trim() || null }), 300)
    return () => window.clearTimeout(t)
  }, [searchText, q, setParam])

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams()
    if (accountId) p.set('accountId', accountId)
    if (q) p.set('q', q)
    return p
  }, [accountId, q])

  const loadSummary = useCallback(async () => {
    try { setSummary(await apiFetch<Summary>(`/files/by-type/summary?${filterQuery}`)) } catch { /* the list shows errors */ }
  }, [filterQuery])

  const loadList = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    const p = new URLSearchParams(filterQuery)
    p.set('category', category)
    p.set('sort', sort)
    p.set('order', order)
    p.set('page', String(page))
    p.set('pageSize', String(PAGE_SIZE))
    try {
      const result = await apiFetch<ListResponse>(`/files/by-type?${p}`)
      if (id !== requestId.current) return
      setData(result)
      setError('')
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [filterQuery, category, sort, order, page])

  useEffect(() => { loadSummary() }, [loadSummary, finishedVersion])
  useEffect(() => { loadList() }, [loadList, finishedVersion])
  useEffect(() => { setSelected(new Map()) }, [category, accountId, q])

  // Thumbnail tokens for the visible page, fetched in one request (grid view only).
  useEffect(() => {
    if (view !== 'grid' || !data) return
    const ids = data.files.filter((f) => (f.category === 'images' || f.category === 'videos') && Number(f.sizeBytes) <= THUMB_MAX_BYTES).map((f) => f.id)
    if (ids.length === 0) return
    apiFetch<{ previews: Record<string, string> }>('/files/preview-tokens', { method: 'POST', body: JSON.stringify({ fileIds: ids }) })
      .then((r) => setPreviews((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(r.previews).map(([k, v]) => [k, `${API_URL}${v}`])) })))
      .catch(() => undefined)
  }, [view, data])

  function changeView(next: View) {
    setView(next)
    try { localStorage.setItem(viewKey, next) } catch { /* private mode */ }
  }

  const files = data?.files ?? []
  const allOnPage = files.length > 0 && files.every((f) => selected.has(f.id))

  function toggle(file: FileRow) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(file.id)) next.delete(file.id); else next.set(file.id, file)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Map(prev)
      if (allOnPage) files.forEach((f) => next.delete(f.id)); else files.forEach((f) => next.set(f.id, f))
      return next
    })
  }

  async function saveBlob(response: Response, fileName: string) {
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  async function download() {
    const list = [...selected.values()]
    if (list.length === 0) return
    setBusy(true)
    setMessage('')
    try {
      const auth = { Authorization: `Bearer ${getAccessToken()}` }
      if (list.length === 1) {
        const r = await fetch(`${API_URL}/files/${list[0].id}/download`, { headers: auth })
        if (!r.ok) throw new Error('Download failed')
        await saveBlob(r, list[0].name)
      } else {
        const r = await fetch(`${API_URL}/files/batch-download`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileIds: list.map((f) => f.id) }) })
        if (!r.ok) throw new Error('Failed to download ZIP file')
        await saveBlob(r, '9drive-download.zip')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  async function rename(event: FormEvent) {
    event.preventDefault()
    const file = [...selected.values()][0]
    if (!file || !renameValue.trim()) return
    setBusy(true)
    try {
      await apiFetch(`/files/${file.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue.trim() }) })
      setRenameOpen(false)
      setSelected(new Map())
      await Promise.all([loadList(), loadSummary()])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ids = [...selected.keys()]
    setBusy(true)
    try {
      await apiFetch('/files/batch', { method: 'DELETE', body: JSON.stringify({ fileIds: ids }) })
      setDeleteOpen(false)
      setSelected(new Map())
      setMessage(`${ids.length} file${ids.length === 1 ? '' : 's'} moved to the Recycle Bin.`)
      await Promise.all([loadList(), loadSummary()])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const tabs: Array<{ key: CategoryKey | 'all'; label: string; count: number; sizeBytes: string }> = [
    { key: 'all', label: 'All', count: summary?.total.count ?? 0, sizeBytes: summary?.total.sizeBytes ?? '0' },
    ...(summary?.categories ?? []),
  ]
  const selectedList = [...selected.values()]

  return (
    <>
      <PageHeader title="Files by type" description="Everything across all your drives, grouped by kind." />

      <div role="tablist" aria-label="File types" className="-mx-1 mt-6 flex gap-2 overflow-x-auto px-1 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={category === tab.key}
            onClick={() => setParam({ type: tab.key === 'all' ? null : tab.key })}
            className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', category === tab.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white hover:border-blue-300')}
          >
            <span className="block text-sm font-extrabold">{tab.label} <span className="font-semibold opacity-80">{tab.count.toLocaleString()}</span></span>
            <span className={cn('block text-xs', category === tab.key ? 'text-blue-100' : 'text-slate-500')}>{formatBytes(tab.sizeBytes)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="sr-only">Search files</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" placeholder="Search by name" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">Drive
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={accountId} onChange={(e) => setParam({ drive: e.target.value || null })}>
            <option value="">All drives</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName && a.displayName !== a.email ? `${a.displayName} (${a.email})` : a.email}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">Sort
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={sort} onChange={(e) => setParam({ sort: e.target.value })}>
            <option value="date">Date</option><option value="name">Name</option><option value="size">Size</option>
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => setParam({ order: order === 'asc' ? 'desc' : null })} aria-label={`Sort order: ${order === 'asc' ? 'ascending' : 'descending'}`}>{order === 'asc' ? 'Ascending' : 'Descending'}</Button>
        <div className="ml-auto flex gap-1" role="group" aria-label="View">
          <Button variant={view === 'list' ? 'soft' : 'ghost'} size="icon" aria-pressed={view === 'list'} aria-label="List view" onClick={() => changeView('list')}><List className="h-4 w-4" /></Button>
          <Button variant={view === 'grid' ? 'soft' : 'ghost'} size="icon" aria-pressed={view === 'grid'} aria-label="Grid view" onClick={() => changeView('grid')}><LayoutGrid className="h-4 w-4" /></Button>
        </div>
      </div>

      {selectedList.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3" role="toolbar" aria-label="Selection actions">
          <span className="text-sm font-extrabold text-blue-900">{selectedList.length} selected</span>
          <Button variant="outline" size="sm" onClick={download} disabled={busy}><Download className="h-4 w-4" />{selectedList.length > 1 ? 'ZIP' : 'Download'}</Button>
          <Button variant="outline" size="sm" disabled={selectedList.length !== 1} onClick={() => { setRenameValue(selectedList[0].name); setRenameOpen(true) }}><Edit3 className="h-4 w-4" />Rename</Button>
          <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}><ArrowRightLeft className="h-4 w-4" />Move to drive</Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />Delete</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>Clear</Button>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}

      <div className="mt-4" aria-busy={loading}>
        {data === null ? (
          <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <Card key={i} className="h-14 animate-pulse" />)}</div>
        ) : files.length === 0 ? (
          <Card className="p-10 text-center">
            <h2 className="text-lg font-extrabold">No files here</h2>
            <p className="mt-2 text-sm text-slate-500">{q || accountId || category !== 'all' ? 'Nothing matches these filters.' : 'Upload files or run Sync Drive in All Files to see them here.'}</p>
            {q || accountId || category !== 'all' ? <Button className="mt-4" variant="outline" onClick={() => { setSearchText(''); setParams({}, { replace: true }) }}>Clear filters</Button> : null}
          </Card>
        ) : view === 'list' ? (
          <Card className={cn('overflow-x-auto', loading && 'opacity-60')}>
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <th className="w-10 py-3 pl-4"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAllOnPage} /></th>
                  <th className="py-3 pr-3 font-semibold">Name</th><th className="py-3 pr-3 font-semibold">Drive</th><th className="py-3 pr-3 font-semibold">Folder</th><th className="py-3 pr-3 text-right font-semibold">Size</th><th className="py-3 pr-4 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className={cn('border-t border-slate-100 hover:bg-slate-50', selected.has(file.id) && 'bg-blue-50/60')}>
                    <td className="py-2.5 pl-4"><input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.has(file.id)} onChange={() => toggle(file)} /></td>
                    <td className="max-w-[20rem] py-2.5 pr-3"><div className="flex items-center gap-3"><TypeIcon category={file.category} className="h-8 w-8" /><span className="truncate font-semibold" title={file.name}>{file.name}</span></div></td>
                    <td className="py-2.5 pr-3"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', badgeTone(file.connectedAccountId))} title={file.connectedAccount.email}>{shortDrive(file)}</span></td>
                    <td className="max-w-[10rem] truncate py-2.5 pr-3 text-slate-500">{file.folder?.name ?? '—'}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right text-slate-500">{formatBytes(file.sizeBytes)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{formatDate(file.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', loading && 'opacity-60')}>
            {files.map((file) => (
              <Card key={file.id} className={cn('p-3', selected.has(file.id) && 'ring-2 ring-blue-500')}>
                <div className="relative">
                  <Thumb file={file} src={previews[file.id]} />
                  <input type="checkbox" className="absolute left-2 top-2 h-4 w-4" aria-label={`Select ${file.name}`} checked={selected.has(file.id)} onChange={() => toggle(file)} />
                </div>
                <p className="mt-2 truncate text-sm font-bold" title={file.name}>{file.name}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{formatBytes(file.sizeBytes)}</span><span className={cn('truncate rounded-full px-2 py-0.5 font-bold', badgeTone(file.connectedAccountId))} title={file.connectedAccount.email}>{shortDrive(file)}</span></div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {data && data.totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
          <p className="text-sm text-slate-500">Page {data.page} of {data.totalPages} · {data.total.toLocaleString()} files</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) }, false)}><ChevronLeft className="h-4 w-4" />Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setParam({ page: String(page + 1) }, false)}>Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </nav>
      ) : null}

      <MoveToDriveDialog
        open={moveOpen}
        files={selectedList.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, accountId: f.connectedAccountId }))}
        onClose={() => setMoveOpen(false)}
        onStarted={() => setSelected(new Map())}
      />
      <DummyModal open={renameOpen} title="Rename file" description={selectedList[0]?.name ?? ''} onClose={() => setRenameOpen(false)}>
        <form onSubmit={rename} className="grid gap-4">
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" aria-label="New name" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button><Button disabled={busy || !renameValue.trim()}>Rename</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={deleteOpen} title={selectedList.length > 1 ? 'Delete files' : 'Delete file'} description={`${selectedList.length} file${selectedList.length === 1 ? '' : 's'} will move to the Recycle Bin. You can restore them from there.`} onClose={() => setDeleteOpen(false)}>
        <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={remove} disabled={busy}>Delete</Button></div>
      </DummyModal>
    </>
  )
}
