import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRightLeft, CheckSquare, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Folder, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DeleteFilesDialog } from '@/components/drive/DeleteFilesDialog'
import { MoveToDriveDialog, type MovableFile } from '@/components/drive/MoveToDriveDialog'
import { badgeTone, downloadIndexedFile, driveName, googleDriveLink, Thumb, ViewToggle, type IndexedRow } from '@/components/drive/drive-bits'
import { useJobs } from '@/context/JobsContext'
import { useToast } from '@/context/ToastContext'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

type FolderEntry = { name: string; path: string; count: number; sizeBytes: string }
type BrowseResponse = { path: string; folders: FolderEntry[]; page: number; totalPages: number; total: number; files: IndexedRow[] }
type SearchResponse = { page: number; totalPages: number; total: number; files: IndexedRow[] }
type ScanAccount = { accountId: string; email: string; status: 'never' | 'idle' | 'running' | 'done' | 'failed'; itemsFound: number; indexedCount: number; error: string | null }
type Summary = { drives: Array<{ accountId: string; count: number; sizeBytes: string }> }
type Selection = { key: string; kind: 'file' | 'folder'; file?: IndexedRow; folder?: FolderEntry; accountId: string }
type View = 'list' | 'grid'

const ROOT = 'My Drive'
const viewKey = '9drive:drive-browser-view'

/**
 * The drive file browser. Without `driveId` it is "All Files": every drive merged, with drive chips that open a drive.
 * With `driveId` it is the explorer for one drive, which works like Google Drive: folders, grid/list, select files or
 * whole folders, then move or copy them to another drive.
 */
export function DriveFilesBrowser({ driveId }: { driveId?: string }) {
  const [params, setParams] = useSearchParams()
  const { finishedVersion, refresh } = useJobs()
  const toast = useToast()
  const explorer = Boolean(driveId)
  const path = params.get('path') || ROOT
  const accountId = driveId ?? params.get('drive') ?? ''
  const q = params.get('q')?.trim() ?? ''
  const sort = (['name', 'size', 'date'].includes(params.get('sort') ?? '') ? params.get('sort') : 'name') as 'name' | 'size' | 'date'
  const order = params.get('order') === 'desc' ? 'desc' : 'asc'
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)

  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(viewKey) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const [browse, setBrowse] = useState<BrowseResponse | null>(null)
  const [search, setSearch] = useState<SearchResponse | null>(null)
  const [scan, setScan] = useState<ScanAccount[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map())
  const [dialog, setDialog] = useState<'move' | 'copy' | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const requestId = useRef(0)
  const autoScanned = useRef(false)
  const wasScanning = useRef(false)

  const setParam = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    if (resetPage) next.delete('page')
    setParams(next)
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

  // First visit: nothing has been scanned yet, so read the drives automatically.
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
      await apiFetch('/drive-index/scan', { method: 'POST', body: JSON.stringify(driveId ? { accountIds: [driveId] } : {}) })
      await loadScan()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the scan')
    }
  }

  function changeView(next: View) {
    setView(next)
    try { localStorage.setItem(viewKey, next) } catch { /* private mode */ }
  }

  const files = (browse ?? search)?.files ?? []
  const folders = browse?.folders ?? []
  const totalPages = (browse ?? search)?.totalPages ?? 1
  const allFilesOnPage = files.length > 0 && files.every((f) => selected.has(`f:${f.id}`))
  const selectedList = [...selected.values()]
  const selectedBytes = selectedList.reduce((sum, s) => sum + Number(s.file?.sizeBytes ?? s.folder?.sizeBytes ?? 0), 0)
  const crumbs = useMemo(() => path.split('/').filter(Boolean), [path])
  const driveStats = new Map((summary?.drives ?? []).map((d) => [d.accountId, d]))
  const totalAll = (summary?.drives ?? []).reduce((s, d) => ({ count: s.count + d.count, size: s.size + Number(d.sizeBytes) }), { count: 0, size: 0 })
  const thisScan = driveId ? scan.find((s) => s.accountId === driveId) : undefined
  const scanProblem = (driveId ? thisScan : scan.find((s) => s.status === 'failed'))?.status === 'failed' ? (driveId ? thisScan : scan.find((s) => s.status === 'failed')) : undefined
  const rootLabel = explorer ? (scan.find((s) => s.accountId === driveId)?.email.split('@')[0] ?? 'Drive') : ROOT

  const toggleFile = (file: IndexedRow) => setSelected((prev) => {
    const next = new Map(prev)
    const key = `f:${file.id}`
    if (next.has(key)) next.delete(key); else next.set(key, { key, kind: 'file', file, accountId: file.connectedAccountId })
    return next
  })
  const toggleFolder = (folder: FolderEntry) => setSelected((prev) => {
    const next = new Map(prev)
    const key = `d:${folder.path}`
    if (next.has(key)) next.delete(key); else next.set(key, { key, kind: 'folder', folder, accountId })
    return next
  })
  const toggleAllFiles = () => setSelected((prev) => {
    const next = new Map(prev)
    for (const f of files) {
      const key = `f:${f.id}`
      if (allFilesOnPage) next.delete(key); else next.set(key, { key, kind: 'file', file: f, accountId: f.connectedAccountId })
    }
    return next
  })

  const totalFilesInView = (browse ?? search)?.total ?? 0
  const everythingSelected = selected.size > 0 && selected.size >= totalFilesInView + (explorer ? folders.length : 0)
  const selectedFolders = selectedList.filter((s) => s.kind === 'folder')
  const deleteFileCount = selectedList.filter((s) => s.kind === 'file').length + selectedFolders.reduce((n, s) => n + (s.folder?.count ?? 0), 0)

  /** Selects everything in the current folder or search, across all pages (up to 5,000 files). */
  async function selectAllInView() {
    setSelectingAll(true)
    try {
      const next = new Map<string, Selection>()
      if (explorer) for (const f of folders) next.set(`d:${f.path}`, { key: `d:${f.path}`, kind: 'folder', folder: f, accountId })
      let pageNo = 1
      let pages = 1
      do {
        const p = new URLSearchParams({ sort, order, page: String(pageNo), pageSize: '200' })
        if (accountId) p.set('accountId', accountId)
        let rows: IndexedRow[]
        if (q) {
          p.set('q', q)
          const r = await apiFetch<SearchResponse>(`/drive-index?${p}`)
          rows = r.files
          pages = r.totalPages
        } else {
          p.set('path', path)
          const r = await apiFetch<BrowseResponse>(`/drive-index/browse?${p}`)
          rows = r.files
          pages = r.totalPages
        }
        for (const f of rows) next.set(`f:${f.id}`, { key: `f:${f.id}`, kind: 'file', file: f, accountId: f.connectedAccountId })
        pageNo += 1
      } while (pageNo <= pages && pageNo <= 25)
      setSelected(next)
      if (pages > 25) toast.info('Selected the first 5,000 files. Narrow the view to select the rest.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not select all')
    } finally {
      setSelectingAll(false)
    }
  }

  async function confirmDelete(permanent: boolean) {
    setBusy(true)
    try {
      const r = await apiFetch<{ jobId: string; count: number }>('/drive-index/delete', {
        method: 'POST',
        body: JSON.stringify({
          driveItemIds: selectedList.filter((s) => s.kind === 'file').map((s) => s.file!.id),
          folders: selectedFolders.map((s) => ({ accountId: s.accountId, path: s.folder!.path })),
          permanent,
        }),
      })
      toast.success(`${permanent ? 'Deleting' : 'Moving to trash'}: ${r.count.toLocaleString()} file${r.count === 1 ? '' : 's'}. Progress is shown at the bottom left.`)
      setDeleteOpen(false)
      setSelected(new Map())
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const movable: MovableFile[] = selectedList.map((s) => s.kind === 'folder'
    ? { id: s.folder!.path, kind: 'folder' as const, path: s.folder!.path, count: s.folder!.count, name: s.folder!.name, sizeBytes: s.folder!.sizeBytes, accountId: s.accountId }
    : { id: s.file!.id, kind: 'drive' as const, name: s.file!.name, mimeType: s.file!.mimeType, sizeBytes: s.file!.sizeBytes, accountId: s.accountId })

  const empty = !loading && files.length === 0 && folders.length === 0
  const single = selectedList.length === 1 && selectedList[0].kind === 'file' ? selectedList[0].file! : null
  const goFolder = (p: string) => setParam({ path: p === ROOT ? null : p })
  const crumbPath = (i: number) => (i === 0 ? ROOT : crumbs.slice(0, i + 1).join('/'))

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          {q ? <span className="font-semibold">Search results for “{q}”</span> : crumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden /> : null}
              <button className={cn('rounded px-1 font-semibold hover:bg-slate-100', i === crumbs.length - 1 && 't-link')} onClick={() => goFolder(crumbPath(i))}>{i === 0 ? rootLabel : c}</button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold">Sort
            <select className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={sort} onChange={(e) => setParam({ sort: e.target.value === 'name' ? null : e.target.value })}>
              <option value="name">Name</option><option value="size">Size</option><option value="date">Modified</option>
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => setParam({ order: order === 'asc' ? 'desc' : null })}>{order === 'asc' ? 'Ascending' : 'Descending'}</Button>
          <ViewToggle view={view} onChange={changeView} />
          <Button variant="outline" size="sm" onClick={() => (everythingSelected ? setSelected(new Map()) : selectAllInView())} disabled={selectingAll || (files.length === 0 && folders.length === 0)}><CheckSquare className="h-4 w-4" />{selectingAll ? 'Selecting...' : everythingSelected ? 'Clear selection' : `Select all${totalFilesInView > files.length ? ` ${totalFilesInView.toLocaleString()}` : ''}`}</Button>
          <Button variant="outline" size="sm" onClick={rescan} disabled={scanning}><RefreshCw className={cn('h-4 w-4', scanning && 'animate-spin')} />{scanning ? 'Scanning...' : 'Rescan'}</Button>
        </div>
      </div>

      {!explorer ? (
        <div role="group" aria-label="Drives" className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
          <button aria-pressed={!accountId} onClick={() => setParam({ drive: null, path: null })} className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', !accountId ? 'on-accent border-blue-600 bg-blue-600' : 'border-slate-200 bg-white hover:border-blue-300')}>
            <span className="block text-sm font-extrabold">All drives</span>
            <span className={cn('block text-xs', !accountId ? 'on-accent-muted' : 'text-slate-500')}>{totalAll.count.toLocaleString()} files · {formatBytes(totalAll.size)}</span>
          </button>
          {scan.map((s) => (
            <Link key={s.accountId} to={`/drives/${s.accountId}`} title={`Open ${s.email} like Google Drive`} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-left transition hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <span className="flex items-center gap-1.5 text-sm font-extrabold"><Folder className="h-3.5 w-3.5 t-link" aria-hidden />{driveName(s)}</span>
              <span className="block text-xs text-slate-500">{(driveStats.get(s.accountId)?.count ?? 0).toLocaleString()} files · {formatBytes(driveStats.get(s.accountId)?.sizeBytes ?? 0)}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {scanning ? <p role="status" className="mt-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">Reading your drives: {scan.reduce((s, a) => s + (a.status === 'running' ? a.itemsFound : 0), 0).toLocaleString()} files found so far. This page fills in as it goes.</p> : null}
      {scanProblem ? <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm t-bad">Scan of {scanProblem.email} failed: {scanProblem.error ?? 'unknown error'} <button className="ml-2 font-bold underline" onClick={rescan}>Retry</button></p> : null}

      {selectedList.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3" role="toolbar" aria-label="Selection actions">
          <span className="text-sm font-extrabold text-blue-900">{selectedList.length.toLocaleString()} selected · {formatBytes(selectedBytes)}</span>
          <Button size="sm" onClick={() => setDialog('move')}><ArrowRightLeft className="h-4 w-4" />Move to drive</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('copy')}><Copy className="h-4 w-4" />Copy to drive</Button>
          <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />Delete</Button>
          {single ? <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await downloadIndexedFile(single.id, single.name) } catch (e) { toast.error(e instanceof Error ? e.message : 'Download failed') } finally { setBusy(false) } }}><Download className="h-4 w-4" />Download</Button> : null}
          {single ? <a className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50" target="_blank" rel="noreferrer" href={googleDriveLink(single)}><ExternalLink className="h-4 w-4" />Open in Google Drive</a> : null}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>Clear</Button>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm t-bad">{error}</p> : null}

      <div className="mt-3" aria-busy={loading}>
        {loading && !browse && !search ? <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <Card key={i} className="h-14 animate-pulse" />)}</div> : empty ? (
          <Card className="p-10 text-center">
            <FolderOpen className="mx-auto h-9 w-9 text-slate-400" />
            <h2 className="mt-3 text-lg font-extrabold">{q ? 'No files match your search' : scanning ? 'Reading your drives...' : 'This folder is empty'}</h2>
            <p className="mt-2 text-sm text-slate-500">{q ? 'Try a different name.' : scanning ? 'Files appear here as the scan finds them.' : 'Go up a level, or press Rescan if files were added recently.'}</p>
          </Card>
        ) : view === 'grid' ? (
          <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', loading && 'opacity-60')}>
            {folders.map((f) => (
              <Card key={f.path} className={cn('p-3', selected.has(`d:${f.path}`) && 'ring-2 ring-blue-500')}>
                <div className="relative">
                  <button className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-xl bg-amber-50 hover:bg-amber-100" onClick={() => goFolder(f.path)} aria-label={`Open folder ${f.name}`}>
                    <Folder className="h-14 w-14 text-amber-500" aria-hidden />
                  </button>
                  {explorer ? <input type="checkbox" className="absolute left-2 top-2 h-4 w-4" aria-label={`Select folder ${f.name}`} checked={selected.has(`d:${f.path}`)} onChange={() => toggleFolder(f)} /> : null}
                </div>
                <p className="mt-2 truncate text-sm font-bold" title={f.name}>{f.name}</p>
                <p className="text-xs text-slate-500">{f.count.toLocaleString()} files · {formatBytes(f.sizeBytes)}</p>
              </Card>
            ))}
            {files.map((file) => (
              <Card key={file.id} className={cn('p-3', selected.has(`f:${file.id}`) && 'ring-2 ring-blue-500')}>
                <div className="relative">
                  <Thumb file={file} />
                  <input type="checkbox" className="absolute left-2 top-2 h-4 w-4" aria-label={`Select ${file.name}`} checked={selected.has(`f:${file.id}`)} onChange={() => toggleFile(file)} />
                </div>
                <p className="mt-2 truncate text-sm font-bold" title={file.name}>{file.name}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{formatBytes(file.sizeBytes)}</span>{explorer ? null : <span className={cn('truncate', badgeTone(file.connectedAccountId))} title={file.connectedAccount.email}>{driveName(file.connectedAccount)}</span>}</div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className={cn('overflow-x-auto', loading && 'opacity-60')}>
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <th className="w-10 py-3 pl-4"><input type="checkbox" aria-label="Select all files in this view" checked={allFilesOnPage} onChange={toggleAllFiles} disabled={files.length === 0} /></th>
                  <th className="py-3 pr-3 font-semibold">Name</th>{q ? <th className="py-3 pr-3 font-semibold">Folder</th> : null}{explorer ? null : <th className="py-3 pr-3 font-semibold">Drive</th>}<th className="py-3 pr-3 text-right font-semibold">Size</th><th className="py-3 pr-4 font-semibold">Modified</th>
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.path} className={cn('cursor-pointer border-t border-slate-100 hover:bg-slate-50', selected.has(`d:${f.path}`) && 'bg-blue-50/60')} onClick={() => goFolder(f.path)}>
                    <td className="py-2.5 pl-4" onClick={(e) => e.stopPropagation()}>{explorer ? <input type="checkbox" aria-label={`Select folder ${f.name}`} checked={selected.has(`d:${f.path}`)} onChange={() => toggleFolder(f)} /> : null}</td>
                    <td className="max-w-[22rem] py-2.5 pr-3"><button className="flex w-full items-center gap-3 text-left" onClick={(e) => { e.stopPropagation(); goFolder(f.path) }}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 t-warn"><Folder className="h-4 w-4" aria-hidden /></span><span className="truncate font-semibold">{f.name}</span><span className="shrink-0 text-xs text-slate-500">{f.count.toLocaleString()} file{f.count === 1 ? '' : 's'}</span></button></td>
                    {q ? <td /> : null}{explorer ? null : <td />}
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right text-slate-500">{formatBytes(f.sizeBytes)}</td>
                    <td className="py-2.5 pr-4 text-slate-400">—</td>
                  </tr>
                ))}
                {files.map((file) => (
                  <tr key={file.id} className={cn('border-t border-slate-100 hover:bg-slate-50', selected.has(`f:${file.id}`) && 'bg-blue-50/60')}>
                    <td className="py-2.5 pl-4"><input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.has(`f:${file.id}`)} onChange={() => toggleFile(file)} /></td>
                    <td className="max-w-[22rem] py-2.5 pr-3"><div className="flex items-center gap-3"><Thumb file={file} small /><span className="truncate font-semibold" title={file.name}>{file.name}</span></div></td>
                    {q ? <td className="max-w-[14rem] truncate py-2.5 pr-3 text-slate-500" title={file.path}>{file.path.replace(/^My Drive\/?/, '') || 'My Drive'}</td> : null}
                    {explorer ? null : <td className="py-2.5 pr-3"><span className={badgeTone(file.connectedAccountId)} title={file.connectedAccount.email}>{driveName(file.connectedAccount)}</span></td>}
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right text-slate-500">{formatBytes(file.sizeBytes)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{file.modifiedAt ? formatDate(file.modifiedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {!explorer && !accountId && !q ? <p className="mt-3 text-xs text-slate-500">Tip: click a drive above to open it like Google Drive and move or copy whole folders.</p> : null}

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
          <p className="text-sm text-slate-500">Page {page} of {totalPages}{browse ? ` · ${browse.total.toLocaleString()} files in this folder` : ''}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) }, false)}><ChevronLeft className="h-4 w-4" />Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setParam({ page: String(page + 1) }, false)}>Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </nav>
      ) : null}

      <DeleteFilesDialog open={deleteOpen} fileCount={deleteFileCount} folderCount={selectedFolders.length} bytes={selectedBytes} busy={busy} onClose={() => setDeleteOpen(false)} onConfirm={confirmDelete} />
      <MoveToDriveDialog
        open={dialog !== null}
        operation={dialog ?? 'move'}
        files={movable}
        onClose={() => setDialog(null)}
        onStarted={() => setSelected(new Map())}
      />
    </>
  )
}
