import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRightLeft, CheckSquare, Eye, ChevronLeft, Copy, Trash2, ChevronRight, Download, ExternalLink, FolderOpen, RefreshCw, Search, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DeleteFilesDialog } from '@/components/drive/DeleteFilesDialog'
import { canPreview, FileViewer } from '@/components/drive/FileViewer'
import { MoveToDriveDialog } from '@/components/drive/MoveToDriveDialog'
import { PageHeader } from '@/components/drive/PageHeader'
import { useJobs } from '@/context/JobsContext'
import { useToast } from '@/context/ToastContext'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { badgeTone, downloadIndexedFile, driveName, googleDriveLink, RowMenu, Thumb, ViewToggle, type IndexedRow, type MenuAction } from '@/components/drive/drive-bits'
import { isCategoryKey, type CategoryKey } from '@/lib/file-types'
import { cn } from '@/lib/utils'

type Row = IndexedRow
type ListResponse = { page: number; pageSize: number; total: number; totalPages: number; files: Row[] }
type Summary = {
  total: { count: number; sizeBytes: string }
  categories: Array<{ key: CategoryKey; label: string; count: number; sizeBytes: string }>
  drives: Array<{ accountId: string; count: number; sizeBytes: string }>
}
type ScanAccount = { accountId: string; email: string; displayName: string | null; status: 'never' | 'idle' | 'running' | 'done' | 'failed'; itemsFound: number; indexedCount: number; indexedBytes: string; error: string | null; finishedAt: string | null }
type Account = { id: string; email: string; displayName: string | null }
type View = 'list' | 'grid'

const PAGE_SIZE = 50
const GB = 1024 ** 3
const viewKey = '9drive:files-by-type-view'
const sizeFilters = [{ label: 'Any size', value: '' }, { label: 'Over 1 MB', value: '1' }, { label: 'Over 10 MB', value: '10' }, { label: 'Over 100 MB', value: '100' }, { label: 'Over 1 GB', value: '1024' }]

export function FilesByTypePage() {
  const [params, setParams] = useSearchParams()
  const { finishedVersion, refresh } = useJobs()
  const toast = useToast()
  const category = (isCategoryKey(params.get('type')) ? params.get('type') : 'all') as CategoryKey | 'all'
  const accountId = params.get('drive') ?? ''
  const q = params.get('q') ?? ''
  const minSizeMb = params.get('min') ?? ''
  const sort = (['name', 'size', 'date', 'path'].includes(params.get('sort') ?? '') ? params.get('sort') : 'size') as 'name' | 'size' | 'date' | 'path'
  const order = params.get('order') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)

  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(viewKey) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const [searchText, setSearchText] = useState(q)
  const [data, setData] = useState<ListResponse | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [scan, setScan] = useState<ScanAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Map<string, Row>>(new Map())
  const [dialog, setDialog] = useState<'move' | 'copy' | null>(null)
  const [sizeGb, setSizeGb] = useState('5')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [selectingAll, setSelectingAll] = useState(false)
  const requestId = useRef(0)
  const wasScanning = useRef(false)

  const setParam = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k) }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }, [params, setParams])

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams()
    if (accountId) p.set('accountId', accountId)
    if (q) p.set('q', q)
    if (minSizeMb) p.set('minSizeMb', minSizeMb)
    return p
  }, [accountId, q, minSizeMb])

  const loadScan = useCallback(async () => {
    try { setScan((await apiFetch<{ accounts: ScanAccount[] }>('/drive-index/scan')).accounts) } catch { /* shown elsewhere */ }
  }, [])
  const loadSummary = useCallback(async () => {
    try { setSummary(await apiFetch<Summary>(`/drive-index/summary?${filterQuery}&category=${category}`)) } catch { /* list shows errors */ }
  }, [filterQuery, category])
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
      const result = await apiFetch<ListResponse>(`/drive-index?${p}`)
      if (id !== requestId.current) return
      setData(result)
      setError('')
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [filterQuery, category, sort, order, page])

  useEffect(() => { apiFetch<{ accounts: Account[] }>('/connected-accounts').then((r) => setAccounts(r.accounts.filter((a) => (a as Account & { provider?: string }).provider !== 's3'))).catch(() => undefined) }, [])
  useEffect(() => { loadScan() }, [loadScan])
  useEffect(() => { loadSummary() }, [loadSummary, finishedVersion])
  useEffect(() => { loadList() }, [loadList, finishedVersion])
  useEffect(() => { setSelected(new Map()) }, [category, accountId, q, minSizeMb])

  useEffect(() => {
    if (searchText === q) return undefined
    const t = window.setTimeout(() => setParam({ q: searchText.trim() || null }), 300)
    return () => window.clearTimeout(t)
  }, [searchText, q, setParam])

  // While a scan runs, poll its progress; when it ends, reload the data.
  const scanning = scan.some((s) => s.status === 'running')
  useEffect(() => {
    if (!scanning) {
      if (wasScanning.current) { wasScanning.current = false; loadSummary(); loadList() }
      return undefined
    }
    wasScanning.current = true
    const t = window.setInterval(loadScan, 2000)
    return () => window.clearInterval(t)
  }, [scanning, loadScan, loadSummary, loadList])

  async function startScan(ids?: string[]) {
    try {
      const r = await apiFetch<{ started: string[] }>('/drive-index/scan', { method: 'POST', body: JSON.stringify(ids ? { accountIds: ids } : {}) })
      if (r.started.length === 0) toast.info('Scan already in progress.')
      await loadScan()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the scan')
    }
  }

  function changeView(next: View) {
    setView(next)
    try { localStorage.setItem(viewKey, next) } catch { /* private mode */ }
  }

  const files = data?.files ?? []
  const allOnPage = files.length > 0 && files.every((f) => selected.has(f.id))
  const selectedList = [...selected.values()]
  const selectedBytes = selectedList.reduce((sum, f) => sum + Number(f.sizeBytes), 0)

  function toggle(file: Row) {
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

  async function pickBySize() {
    const gb = Number(sizeGb)
    if (!(gb > 0)) return
    setPicking(true)
    try {
      const p = new URLSearchParams(filterQuery)
      p.set('category', category)
      p.set('bytes', String(Math.round(gb * GB)))
      const r = await apiFetch<{ files: Row[]; count: number; totalBytes: string; reachedTarget: boolean }>(`/drive-index/select-by-size?${p}`)
      setSelected(new Map(r.files.map((f) => [f.id, f])))
      if (r.count === 0) toast.info('No files match these filters.')
      else if (!r.reachedTarget) toast.info(`Only ${formatBytes(r.totalBytes)} available in ${r.count} files with these filters.`)
      else toast.success(`Selected the ${r.count} largest files (${formatBytes(r.totalBytes)}).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Selection failed')
    } finally {
      setPicking(false)
    }
  }

  /** Selects every file matching the current filters (up to 3,000, largest first). */
  async function selectAllMatching() {
    setSelectingAll(true)
    try {
      const p = new URLSearchParams(filterQuery)
      p.set('category', category)
      p.set('bytes', '1000000000000000')
      const r = await apiFetch<{ files: Row[]; count: number; totalBytes: string }>(`/drive-index/select-by-size?${p}`)
      setSelected(new Map(r.files.map((f) => [f.id, f])))
      if (r.count >= 3000) toast.info('Selected the 3,000 largest matching files. Narrow the filters to select the rest.')
      else toast.success(`Selected ${r.count.toLocaleString()} files (${formatBytes(r.totalBytes)}).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not select all')
    } finally {
      setSelectingAll(false)
    }
  }

  async function confirmDelete(permanent: boolean) {
    setBusy(true)
    try {
      const r = await apiFetch<{ jobId: string; count: number }>('/drive-index/delete', { method: 'POST', body: JSON.stringify({ driveItemIds: selectedList.map((f) => f.id), permanent }) })
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

  async function downloadOne(file: Row) {
    setBusy(true)
    try {
      await downloadIndexedFile(file.id, file.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  const previewable = useMemo(() => files.filter(canPreview), [files])
  const openViewer = (file: Row) => { const i = previewable.findIndex((f) => f.id === file.id); if (i >= 0) setViewing(i) }
  const openFile = (file: Row) => {
    if (canPreview(file)) openViewer(file)
    else window.open(googleDriveLink(file), '_blank', 'noopener')
  }
  const actOn = (file: Row, action: 'move' | 'copy' | 'delete') => {
    setSelected(new Map([[file.id, file]]))
    if (action === 'delete') setDeleteOpen(true); else setDialog(action)
  }
  const rowActions = (file: Row): MenuAction[] => [
    ...(canPreview(file) ? [{ label: 'Preview', icon: Eye, onClick: () => openViewer(file) }] : []),
    { label: 'Move to drive…', icon: ArrowRightLeft, onClick: () => actOn(file, 'move') },
    { label: 'Copy to drive…', icon: Copy, onClick: () => actOn(file, 'copy') },
    { label: 'Download', icon: Download, onClick: () => { downloadOne(file) } },
    { label: 'Open in Google Drive', icon: ExternalLink, href: googleDriveLink(file), onClick: () => undefined },
    { label: 'Delete…', icon: Trash2, danger: true, onClick: () => actOn(file, 'delete') },
  ]

  const driveLookup = useMemo(() => new Map([...scan.map((s) => [s.accountId, s.email] as const), ...accounts.map((a) => [a.id, a.email] as const)]), [scan, accounts])
  const neverScanned = scan.length > 0 && scan.every((s) => s.status === 'never')
  const driveStats = new Map((summary?.drives ?? []).map((d) => [d.accountId, d]))
  const tabs: Array<{ key: CategoryKey | 'all'; label: string; count: number; sizeBytes: string }> = [
    { key: 'all', label: 'All', count: summary?.total.count ?? 0, sizeBytes: summary?.total.sizeBytes ?? '0' },
    ...(summary?.categories ?? []),
  ]
  const filtersActive = Boolean(q || accountId || category !== 'all' || minSizeMb)

  return (
    <>
      <PageHeader
        title="Files by type"
        description="Every file you own in your connected drives, grouped by kind. Select files and move them to another drive."
        actions={<Button variant="outline" onClick={() => startScan()} disabled={scanning}><RefreshCw className={cn('h-4 w-4', scanning && 'animate-spin')} />{scanning ? 'Scanning...' : 'Scan drives'}</Button>}
      />

      {neverScanned ? (
        <Card className="mt-6 p-6 text-center">
          <FolderOpen className="mx-auto h-9 w-9 t-link" />
          <h2 className="mt-3 text-lg font-extrabold">Scan your drives to list every file</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">9Drive reads the file names, sizes and folders in each connected drive (it does not download anything). Large drives can take a minute or two.</p>
          <Button className="mt-4" onClick={() => startScan()} disabled={scanning}>Scan all drives</Button>
        </Card>
      ) : null}

      {scan.some((s) => s.status === 'running' || s.status === 'failed') ? (
        <div className="mt-4 grid gap-2">
          {scan.filter((s) => s.status === 'running' || s.status === 'failed').map((s) => (
            <p key={s.accountId} className={cn('rounded-xl p-3 text-sm', s.status === 'failed' ? 'bg-red-50 t-bad' : 'bg-blue-50 text-blue-700')} role={s.status === 'failed' ? 'alert' : 'status'}>
              {s.status === 'running' ? `Scanning ${s.email}: ${s.itemsFound.toLocaleString()} files found so far...` : `Scan of ${s.email} failed: ${s.error ?? 'unknown error'}`}
              {s.status === 'failed' ? <button className="ml-2 font-bold underline" onClick={() => startScan([s.accountId])}>Retry</button> : null}
            </p>
          ))}
        </div>
      ) : null}

      <div role="group" aria-label="Drives" className="-mx-1 mt-6 flex gap-2 overflow-x-auto px-1 pb-2">
        {[{ id: '', label: 'All drives', count: (summary?.drives ?? []).reduce((s, d) => s + d.count, 0), size: (summary?.drives ?? []).reduce((s, d) => s + Number(d.sizeBytes), 0) },
          ...scan.map((s) => ({ id: s.accountId, label: driveName(s), count: driveStats.get(s.accountId)?.count ?? 0, size: Number(driveStats.get(s.accountId)?.sizeBytes ?? 0) }))].map((d) => (
          <button key={d.id || 'all'} aria-pressed={accountId === d.id} onClick={() => setParam({ drive: d.id || null })} className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', accountId === d.id ? 'on-accent border-blue-600 bg-blue-600' : 'border-slate-200 bg-white hover:border-blue-300')}>
            <span className="block text-sm font-extrabold">{d.label}</span>
            <span className={cn('block text-xs', accountId === d.id ? 'on-accent-muted' : 'text-slate-500')}>{d.count.toLocaleString()} files · {formatBytes(d.size)}</span>
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="File types" className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-2">
        {tabs.map((tab) => (
          <button key={tab.key} role="tab" aria-selected={category === tab.key} onClick={() => setParam({ type: tab.key === 'all' ? null : tab.key })} className={cn('shrink-0 rounded-xl border px-3.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', category === tab.key ? 'on-accent border-violet-700 bg-violet-700' : 'border-slate-200 bg-white hover:border-violet-300')}>
            <span className="block text-sm font-extrabold">{tab.label} <span className="font-semibold">{tab.count.toLocaleString()}</span></span>
            <span className={cn('block text-xs', category === tab.key ? 'on-accent-muted' : 'text-slate-500')}>{formatBytes(tab.sizeBytes)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="sr-only">Search by file name or folder</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" placeholder="Search name or folder" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">Size
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={minSizeMb} onChange={(e) => setParam({ min: e.target.value || null })}>{sizeFilters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">Sort
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={sort} onChange={(e) => setParam({ sort: e.target.value })}>
            <option value="size">Size</option><option value="name">Name</option><option value="date">Modified</option><option value="path">Folder</option>
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => setParam({ order: order === 'asc' ? null : 'asc' })} aria-label={`Sort order: ${order === 'asc' ? 'ascending' : 'descending'}`}>{order === 'asc' ? 'Ascending' : 'Descending'}</Button>
        <div className="ml-auto"><ViewToggle view={view} onChange={changeView} /></div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => (selected.size > 0 && selected.size >= (data?.total ?? Infinity) ? setSelected(new Map()) : selectAllMatching())} disabled={selectingAll || (data?.total ?? 0) === 0}><CheckSquare className="h-4 w-4" />{selectingAll ? 'Selecting...' : selected.size > 0 && selected.size >= (data?.total ?? Infinity) ? 'Clear selection' : `Select all${data ? ` ${data.total.toLocaleString()}` : ''}`}</Button></div>
      <Card className="mt-3 flex flex-wrap items-center gap-3 p-3">
        <Wand2 className="h-4 w-4 t-violet" aria-hidden />
        <span className="text-sm font-semibold">Select the largest files totalling</span>
        <input className="h-9 w-20 rounded-xl border border-slate-200 px-3 text-sm" inputMode="decimal" aria-label="Gigabytes to select" value={sizeGb} onChange={(e) => setSizeGb(e.target.value)} />
        <span className="text-sm font-semibold">GB</span>
        <Button size="sm" variant="soft" onClick={pickBySize} disabled={picking || !(Number(sizeGb) > 0)}>{picking ? 'Selecting...' : 'Select'}</Button>
        <span className="text-xs text-slate-500">{accountId ? `from ${driveLookup.get(accountId) ?? 'this drive'}` : 'from all drives'}{category !== 'all' ? `, ${category} only` : ''}. Then choose where to move them.</span>
      </Card>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-3" role="toolbar" aria-label="Actions for selected files">
        <span className="text-sm font-extrabold text-blue-900">{selectedList.length > 0 ? `${selectedList.length.toLocaleString()} selected · ${formatBytes(selectedBytes)}` : 'Nothing selected'}</span>
        {selectedList.length === 0 ? <span className="text-xs text-slate-500">Tick files, or use a row's ⋯ menu, to move, copy or delete.</span> : null}
        <Button size="sm" onClick={() => setDialog('move')} disabled={selectedList.length === 0}><ArrowRightLeft className="h-4 w-4" />Move to drive</Button>
        <Button size="sm" variant="outline" onClick={() => setDialog('copy')} disabled={selectedList.length === 0}><Copy className="h-4 w-4" />Copy to drive</Button>
        <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)} disabled={selectedList.length === 0}><Trash2 className="h-4 w-4" />Delete</Button>
        {selectedList.length === 1 ? <Button variant="outline" size="sm" onClick={() => downloadOne(selectedList[0])} disabled={busy}><Download className="h-4 w-4" />Download</Button> : null}
        {selectedList.length === 1 ? <a className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50" target="_blank" rel="noreferrer" href={googleDriveLink(selectedList[0])}><ExternalLink className="h-4 w-4" />Open in Google Drive</a> : null}
        {selectedList.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>Clear</Button> : null}
      </div>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm t-bad">{error}</p> : null}

      <div className="mt-4" aria-busy={loading}>
        {data === null ? (
          <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <Card key={i} className="h-14 animate-pulse" />)}</div>
        ) : files.length === 0 ? (
          <Card className="p-10 text-center">
            <h2 className="text-lg font-extrabold">{filtersActive ? 'Nothing matches these filters' : 'No files indexed yet'}</h2>
            <p className="mt-2 text-sm text-slate-500">{filtersActive ? 'Try removing a filter.' : 'Use "Scan drives" to list the files in your connected drives.'}</p>
            {filtersActive ? <Button className="mt-4" variant="outline" onClick={() => { setSearchText(''); setParams({}, { replace: true }) }}>Clear filters</Button> : null}
          </Card>
        ) : view === 'list' ? (
          <Card className={cn('overflow-x-auto', loading && 'opacity-60')}>
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <th className="w-10 py-3 pl-4"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAllOnPage} /></th>
                  <th className="py-3 pr-3 font-semibold">Name</th><th className="py-3 pr-3 font-semibold">Folder</th><th className="py-3 pr-3 font-semibold">Drive</th><th className="py-3 pr-3 text-right font-semibold">Size</th><th className="py-3 pr-4 font-semibold">Modified</th><th className="w-12 py-3 pr-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className={cn('select-none border-t border-slate-100 hover:bg-slate-50', selected.has(file.id) && 'row-selected')} onDoubleClick={() => openFile(file)} title="Double-click to open">
                    <td className="py-2.5 pl-4"><input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.has(file.id)} onChange={() => toggle(file)} /></td>
                    <td className="max-w-[18rem] py-2.5 pr-3">{canPreview(file) ? <button type="button" className="flex w-full min-w-0 items-center gap-3 text-left" onClick={() => openViewer(file)} title="Preview"><Thumb file={file} small /><span className="truncate font-semibold hover:underline">{file.name}</span></button> : <div className="flex items-center gap-3"><Thumb file={file} small /><span className="truncate font-semibold" title={file.name}>{file.name}</span></div>}</td>
                    <td className="max-w-[14rem] truncate py-2.5 pr-3 text-slate-500" title={file.path}>{file.path.replace(/^My Drive\/?/, '') || 'My Drive'}</td>
                    <td className="py-2.5 pr-3"><span className={badgeTone(file.connectedAccountId)} title={file.connectedAccount.email}>{driveName(file.connectedAccount)}</span></td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right text-slate-500">{formatBytes(file.sizeBytes)}</td>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{file.modifiedAt ? formatDate(file.modifiedAt) : '—'}</td>
                    <td className="py-2.5 pr-3"><RowMenu label={file.name} actions={rowActions(file)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', loading && 'opacity-60')}>
            {files.map((file) => (
              <Card key={file.id} className={cn('select-none p-3', selected.has(file.id) && 'ring-2 ring-blue-500')} onDoubleClick={() => openFile(file)} title="Double-click to open">
                <div className="relative">
                  {canPreview(file) ? <button type="button" className="block w-full" onClick={() => openViewer(file)} aria-label={`Preview ${file.name}`}><Thumb file={file} /></button> : <Thumb file={file} />}
                  <input type="checkbox" className="absolute left-2 top-2 h-4 w-4" aria-label={`Select ${file.name}`} checked={selected.has(file.id)} onChange={() => toggle(file)} />
                  <div className="card-menu absolute right-1 top-1"><RowMenu label={file.name} actions={rowActions(file)} /></div>
                </div>
                <p className="mt-2 truncate text-sm font-bold" title={file.name}>{file.name}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{formatBytes(file.sizeBytes)}</span><span className={cn('truncate', badgeTone(file.connectedAccountId))} title={file.connectedAccount.email}>{driveName(file.connectedAccount)}</span></div>
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

      {viewing !== null ? <FileViewer files={previewable} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} /> : null}
      <DeleteFilesDialog open={deleteOpen} fileCount={selectedList.length} folderCount={0} bytes={selectedBytes} busy={busy} onClose={() => setDeleteOpen(false)} onConfirm={confirmDelete} />
      <MoveToDriveDialog
        open={dialog !== null}
        operation={dialog ?? 'move'}
        files={selectedList.map((f) => ({ id: f.id, kind: 'drive' as const, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, accountId: f.connectedAccountId }))}
        onClose={() => setDialog(null)}
        onStarted={() => setSelected(new Map())}
      />
    </>
  )
}
