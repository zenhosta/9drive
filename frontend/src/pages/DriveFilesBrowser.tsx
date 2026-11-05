import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRightLeft, ChevronLeft, ChevronRight, Download, ExternalLink, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MoveToDriveDialog } from '@/components/drive/MoveToDriveDialog'
import { badgeTone, downloadIndexedFile, driveName, googleDriveLink, TypeIcon, type IndexedRow } from '@/components/drive/drive-bits'
import { useJobs } from '@/context/JobsContext'
import { useToast } from '@/context/ToastContext'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

type FolderEntry = { name: string; path: string; count: number; sizeBytes: string }
type BrowseResponse = { path: string; folders: FolderEntry[]; page: number; totalPages: number; total: number; files: IndexedRow[] }
type SearchResponse = { page: number; totalPages: number; total: number; files: IndexedRow[] }
type ScanAccount = { accountId: string; email: string; status: 'never' | 'idle' | 'running' | 'done' | 'failed'; itemsFound: number; indexedCount: number; error: string | null }
type Summary = { drives: Array<{ accountId: string; count: number; sizeBytes: string }> }

const ROOT = 'My Drive'

/**
 * All Files: the actual contents of your connected drives as a folder tree (merged across drives, or one drive at a
 * time). The header search switches to a flat search across every folder.
 */
export function DriveFilesBrowser() {
  const [params, setParams] = useSearchParams()
  const { finishedVersion } = useJobs()
  const toast = useToast()
  const path = params.get('path') || ROOT
  const accountId = params.get('drive') ?? ''
  const q = params.get('q')?.trim() ?? ''
  const sort = (['name', 'size', 'date'].includes(params.get('sort') ?? '') ? params.get('sort') : 'name') as 'name' | 'size' | 'date'
  const order = params.get('order') === 'desc' ? 'desc' : 'asc'
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)

  const [browse, setBrowse] = useState<BrowseResponse | null>(null)
  const [search, setSearch] = useState<SearchResponse | null>(null)
  const [scan, setScan] = useState<ScanAccount[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Map<string, IndexedRow>>(new Map())
  const [moveOpen, setMoveOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)
  const autoScanned = useRef(false)
  const wasScanning = useRef(false)

  const setParam = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    if (resetPage) next.delete('page')
    setParams(next, { replace: false })
  }, [params, setParams])

  const loadScan = useCallback(async () => {
    try { setScan((await apiFetch<{ accounts: ScanAccount[] }>('/drive-index/scan')).accounts) } catch { /* list shows errors */ }
  }, [])
  const loadSummary = useCallback(async () => {
    try { setSummary(await apiFetch<Summary>('/drive-index/summary')) } catch { /* optional */ }
  }, [])

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    const p = new URLSearchParams({ sort, order, page: String(page), pageSize: '100' })
    if (accountId) p.set('accountId', accountId)
    try {
      if (q) {
        p.set('q', q)
        const r = await apiFetch<SearchResponse>(`/drive-index?${p}`)
        if (id === requestId.current) { setSearch(r); setBrowse(null) }
      } else {
        p.set('path', path)
        const r = await apiFetch<BrowseResponse>(`/drive-index/browse?${p}`)
        if (id === requestId.current) { setBrowse(r); setSearch(null) }
      }
      if (id === requestId.current) setError('')
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [q, path, accountId, sort, order, page])

  useEffect(() => { loadScan(); loadSummary() }, [loadScan, loadSummary])
  useEffect(() => { load() }, [load, finishedVersion])
  useEffect(() => { setSelected(new Map()) }, [path, accountId, q])

  // First visit: nothing has been scanned, so read the drives automatically.
  useEffect(() => {
    if (autoScanned.current || scan.length === 0 || !scan.every((s) => s.status === 'never')) return
    autoScanned.current = true
    apiFetch('/drive-index/scan', { method: 'POST', body: JSON.stringify({}) }).then(loadScan).catch(() => undefined)
  }, [scan, loadScan])

  const scanning = scan.some((s) => s.status === 'running')
  useEffect(() => {
    if (!scanning) {
      if (wasScanning.current) { wasScanning.current = false; load(); loadSummary() }
      return undefined
    }
    wasScanning.current = true
    const t = window.setInterval(loadScan, 2000)
    return () => window.clearInterval(t)
  }, [scanning, loadScan, load, loadSummary])

  async function rescan() {
    try {
      await apiFetch('/drive-index/scan', { method: 'POST', body: JSON.stringify({}) })
      await loadScan()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the scan')
    }
  }

  const files = (browse ?? search)?.files ?? []
  const folders = browse?.folders ?? []
  const totalPages = (browse ?? search)?.totalPages ?? 1
  const allOnPage = files.length > 0 && files.every((f) => selected.has(f.id))
  const selectedList = [...selected.values()]
  const selectedBytes = selectedList.reduce((sum, f) => sum + Number(f.sizeBytes), 0)
  const crumbs = useMemo(() => path.split('/').filter(Boolean), [path])
  const driveStats = new Map((summary?.drives ?? []).map((d) => [d.accountId, d]))
  const totalAll = (summary?.drives ?? []).reduce((s, d) => ({ count: s.count + d.count, size: s.size + Number(d.sizeBytes) }), { count: 0, size: 0 })

  const toggle = (file: IndexedRow) => setSelected((prev) => {
    const next = new Map(prev)
    if (next.has(file.id)) next.delete(file.id); else next.set(file.id, file)
    return next
  })
  const toggleAll = () => setSelected((prev) => {
    const next = new Map(prev)
    if (allOnPage) files.forEach((f) => next.delete(f.id)); else files.forEach((f) => next.set(f.id, f))
    return next
  })

  const scanProblem = scan.find((s) => s.status === 'failed')
  const empty = !loading && files.length === 0 && folders.length === 0

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {q ? <span className="font-semibold">Search results for “{q}”</span> : crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden /> : null}
              <button className={cn('rounded px-1 font-semibold hover:bg-slate-100', i === crumbs.length - 1 && 'text-blue-600')} onClick={() => setParam({ path: i === 0 ? null : crumbs.slice(0, i + 1).join('/') })}>{c}</button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold">Sort
            <select className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'name' ? null : e.target.value })}>
              <option value="name">Name</option><option value="size">Size</option><option value="date">Modified</option>
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => setParam({ order: order === 'asc' ? 'desc' : null })}>{order === 'asc' ? 'Ascending' : 'Descending'}</Button>
          <Button variant="outline" size="sm" onClick={rescan} disabled={scanning}><RefreshCw className={cn('h-4 w-4', scanning && 'animate-spin')} />{scanning ? 'Scanning...' : 'Rescan'}</Button>
        </div>
      </div>

      <div role="group" aria-label="Drives" className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
        {[{ id: '', label: 'All drives', count: totalAll.count, size: totalAll.size }, ...scan.map((s) => ({ id: s.accountId, label: driveName(s), count: driveStats.get(s.accountId)?.count ?? 0, size: Number(driveStats.get(s.accountId)?.sizeBytes ?? 0) }))].map((d) => (
          <button key={d.id || 'all'} aria-pressed={accountId === d.id} onClick={() => setParam({ drive: d.id || null, path: null })} className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', accountId === d.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white hover:border-blue-300')}>
            <span className="block text-sm font-extrabold">{d.label}</span>
            <span className={cn('block text-xs', accountId === d.id ? 'text-blue-100' : 'text-slate-500')}>{d.count.toLocaleString()} files · {formatBytes(d.size)}</span>
          </button>
        ))}
      </div>

      {scanning ? <p role="status" className="mt-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">Reading your drives: {scan.reduce((s, a) => s + (a.status === 'running' ? a.itemsFound : 0), 0).toLocaleString()} files found so far. This page fills in as it goes.</p> : null}
      {scanProblem ? <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">Scan of {scanProblem.email} failed: {scanProblem.error ?? 'unknown error'} <button className="ml-2 font-bold underline" onClick={rescan}>Retry</button></p> : null}

      {selectedList.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3" role="toolbar" aria-label="Selection actions">
          <span className="text-sm font-extrabold text-blue-900">{selectedList.length.toLocaleString()} selected · {formatBytes(selectedBytes)}</span>
          <Button size="sm" onClick={() => setMoveOpen(true)}><ArrowRightLeft className="h-4 w-4" />Move to drive</Button>
          {selectedList.length === 1 ? <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await downloadIndexedFile(selectedList[0].id, selectedList[0].name) } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed') } finally { setBusy(false) } }}><Download className="h-4 w-4" />Download</Button> : null}
          {selectedList.length === 1 ? <a className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50" target="_blank" rel="noreferrer" href={googleDriveLink(selectedList[0])}><ExternalLink className="h-4 w-4" />Open in Google Drive</a> : null}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>Clear</Button>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-3" aria-busy={loading}>
        {loading && !browse && !search ? <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <Card key={i} className="h-14 animate-pulse" />)}</div> : empty ? (
          <Card className="p-10 text-center">
            <FolderOpen className="mx-auto h-9 w-9 text-slate-400" />
            <h2 className="mt-3 text-lg font-extrabold">{q ? 'No files match your search' : scanning ? 'Reading your drives...' : 'This folder is empty'}</h2>
            <p className="mt-2 text-sm text-slate-500">{q ? 'Try a different name.' : scanning ? 'Files appear here as the scan finds them.' : 'Go up a level, or press Rescan if files were added recently.'}</p>
          </Card>
        ) : (
          <Card className={cn('overflow-x-auto', loading && 'opacity-60')}>
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <th className="w-10 py-3 pl-4"><input type="checkbox" aria-label="Select all files in this view" checked={allOnPage} onChange={toggleAll} disabled={files.length === 0} /></th>
                  <th className="py-3 pr-3 font-semibold">Name</th>{q ? <th className="py-3 pr-3 font-semibold">Folder</th> : null}<th className="py-3 pr-3 font-semibold">Drive</th><th className="py-3 pr-3 text-right font-semibold">Size</th><th className="py-3 pr-4 font-semibold">Modified</th>
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.path} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setParam({ path: f.path })}>
                    <td className="py-2.5 pl-4" />
                    <td className="max-w-[22rem] py-2.5 pr-3"><button className="flex w-full items-center gap-3 text-left" onClick={(e) => { e.stopPropagation(); setParam({ path: f.path }) }}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600"><Folder className="h-4 w-4" aria-hidden /></span><span className="truncate font-semibold">{f.name}</span></button></td>
                    <td className="py-2.5 pr-3 text-slate-500">{f.count.toLocaleString()} file{f.count === 1 ? '' : 's'}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right text-slate-500">{formatBytes(f.sizeBytes)}</td>
                    <td className="py-2.5 pr-4 text-slate-400">—</td>
                  </tr>
                ))}
                {files.map((file) => (
                  <tr key={file.id} className={cn('border-t border-slate-100 hover:bg-slate-50', selected.has(file.id) && 'bg-blue-50/60')}>
                    <td className="py-2.5 pl-4"><input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.has(file.id)} onChange={() => toggle(file)} /></td>
                    <td className="max-w-[22rem] py-2.5 pr-3"><div className="flex items-center gap-3"><TypeIcon category={file.category} className="h-8 w-8" /><span className="truncate font-semibold" title={file.name}>{file.name}</span></div></td>
                    {q ? <td className="max-w-[14rem] truncate py-2.5 pr-3 text-slate-500" title={file.path}>{file.path.replace(/^My Drive\/?/, '') || 'My Drive'}</td> : null}
                    <td className="py-2.5 pr-3"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', badgeTone(file.connectedAccountId))} title={file.connectedAccount.email}>{driveName(file.connectedAccount)}</span></td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right text-slate-500">{formatBytes(file.sizeBytes)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{file.modifiedAt ? formatDate(file.modifiedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
          <p className="text-sm text-slate-500">Page {page} of {totalPages}{browse ? ` · ${browse.total.toLocaleString()} files in this folder` : ''}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) }, false)}><ChevronLeft className="h-4 w-4" />Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setParam({ page: String(page + 1) }, false)}>Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </nav>
      ) : null}

      <MoveToDriveDialog
        open={moveOpen}
        files={selectedList.map((f) => ({ id: f.id, kind: 'drive' as const, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, accountId: f.connectedAccountId }))}
        onClose={() => setMoveOpen(false)}
        onStarted={() => setSelected(new Map())}
      />
    </>
  )
}
