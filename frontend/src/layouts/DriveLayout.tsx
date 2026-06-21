import { type FormEvent, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bell,
  Braces,
  FileArchive,
  Gauge,
  History,
  LogOut,
  Menu,
  Moon,
  MoreVertical,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { Input } from '@/components/ui/input'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { clearAuthSession, getStoredUser, updateStoredUser, type AuthUser } from '@/lib/auth'
import { getGravatarUrl } from '@/lib/gravatar'
import { cn } from '@/lib/utils'

const menu = [
  { label: 'All Files', icon: FileArchive, href: '/all-files' },
  { label: 'Quota Tracker', icon: Gauge, href: '/quota' },
  { label: 'Shared With Me', icon: Share2, href: '/shared' },
  { label: 'Starred', icon: Star, href: '/starred', disabled: true },
  { label: 'Recycle Bin', icon: Trash2, href: '/trash' },
  { label: 'Activity Log', icon: History, href: '/activity' },
  { label: 'Setting', icon: Settings, href: '/settings' },
  { label: 'API Keys', icon: Braces, href: '/api' },
]

type StorageSummary = {
  totalBytes: string
  usedBytes: string
  availableBytes: string
}

type StorageBreakdown = {
  photo: string
  video: string
  document: string
}

type RepoUpdate = {
  sha: string
  title: string
  author: string
  date: string
  url: string
}

type GitHubCommit = {
  sha: string
  html_url: string
  commit: {
    message: string
    author?: {
      name?: string
      date?: string
    }
  }
}

function RepoUpdatesDropdown({ updates, loading, error }: { updates: RepoUpdate[]; loading: boolean; error: string }) {
  return (
    <div className="absolute right-0 top-12 z-50 w-[min(calc(100vw-2rem),24rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/15">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-extrabold text-slate-950">Repository Updates</p>
        <p className="text-xs text-slate-500">Latest commits from zenhosta/9drive</p>
      </div>
      <div className="max-h-96 overflow-y-auto p-2">
        {loading ? <p className="p-4 text-sm text-slate-500">Loading updates...</p> : null}
        {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
        {!loading && !error && updates.length === 0 ? <p className="p-4 text-sm text-slate-500">No updates found.</p> : null}
        {!loading && !error ? updates.map((update) => (
          <a key={update.sha} href={update.url} target="_blank" rel="noreferrer" className="block rounded-xl p-3 transition hover:bg-slate-50">
            <div className="flex items-start justify-between gap-3">
              <p className="line-clamp-2 min-w-0 text-sm font-bold leading-snug text-slate-950">{update.title}</p>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{update.sha}</span>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">{update.author} • {update.date}</p>
          </a>
        )) : null}
      </div>
      <a href="https://github.com/zenhosta/9drive" target="_blank" rel="noreferrer" className="block border-t border-slate-200 px-4 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50">View repository</a>
    </div>
  )
}

function Sidebar({ onNavigate, user, storage, breakdown, onLogout }: { onNavigate?: () => void; user: AuthUser | null; storage: StorageSummary | null; breakdown: StorageBreakdown; onLogout: () => void }) {
  const used = Number(storage?.usedBytes ?? 0)
  const total = Number(storage?.totalBytes ?? 0)
  const progress = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const items = [
    ['Photo', formatBytes(breakdown.photo), 'bg-lime-500'],
    ['Video', formatBytes(breakdown.video), 'bg-yellow-400'],
    ['Document', formatBytes(breakdown.document), 'bg-cyan-400'],
    ['Free Storage', formatBytes(storage?.availableBytes), 'bg-orange-500'],
  ]

  useEffect(() => {
    getGravatarUrl(user?.email, 64).then(setProfileImageUrl).catch(() => setProfileImageUrl(''))
  }, [user?.email])

  return (
    <aside className="flex h-full w-64 flex-col border-slate-200/60 bg-slate-50/40 backdrop-blur-xl p-4 lg:border-r">
      <div className="flex items-center gap-2.5 pb-3 pt-1">
        <BrandLogo className="h-8 w-8" />
        <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">9Drive</span>
      </div>

      <div className="flex items-center gap-2.5 border-y border-slate-200/60 py-3 my-3">
        <img src={profileImageUrl} alt="User avatar" className="h-8 w-8 rounded-full border border-slate-200 object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900 leading-none">{user?.name ?? 'User'}</p>
          <p className="truncate text-[11px] text-slate-500 mt-1">{user?.email ?? 'Loading...'}</p>
        </div>
        <MoreVertical className="h-4 w-4 text-slate-400" />
      </div>

      <nav className="grid gap-1">
        {menu.map((item) => item.disabled ? (
          <button key={item.label} type="button" disabled className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-xl px-3.5 text-xs font-bold text-slate-400 opacity-60">
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ) : (
          <NavLink key={item.label} to={item.href} onClick={onNavigate} className={({ isActive }) => cn('inline-flex h-9 items-center gap-2.5 rounded-xl px-3.5 text-xs font-bold transition-all border border-transparent', isActive ? 'bg-blue-600/10 text-blue-600 border-blue-600/10 shadow-sm' : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900')}>
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-200/60 pt-4 text-[11px]">
        <div className="mb-3 space-y-1">
          {items.map(([label, value, color]) => (
            <div key={label} className="flex items-center justify-between text-slate-500 font-medium">
              <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-1.5 rounded-full', color)} />{label}</span>
              <span className="font-semibold text-slate-700">{value}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between font-bold text-slate-700">
          <span>{formatBytes(storage?.usedBytes)} used</span>
          <span className="text-slate-400">{formatBytes(storage?.totalBytes)}</span>
        </div>
        <div className="my-2 h-1.5 rounded-full bg-slate-200/60 overflow-hidden">
          <div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <Button variant="danger" size="sm" className="mt-3 w-full justify-start h-9 px-3 text-xs font-bold" onClick={onLogout}>
          <LogOut className="h-4 w-4" />Log Out
        </Button>
      </div>
    </aside>
  )
}

type ConnectedAccount = {
  id: string
  email: string
  provider: string
}

export function DriveLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(searchParams.get('q') ?? '')
  const [user, setUser] = useState<AuthUser | null>(getStoredUser())
  const [storage, setStorage] = useState<StorageSummary | null>(null)
  const [breakdown, setBreakdown] = useState<StorageBreakdown>({ photo: '0', video: '0', document: '0' })
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [updates, setUpdates] = useState<RepoUpdate[]>([])
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [updatesError, setUpdatesError] = useState('')
  const [updatesLoaded, setUpdatesLoaded] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('9drive:theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  // Advanced search states
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterKind, setFilterKind] = useState(searchParams.get('kind') ?? '')
  const [filterAccountId, setFilterAccountId] = useState(searchParams.get('accountId') ?? '')
  const [filterMinSize, setFilterMinSize] = useState(() => {
    const min = searchParams.get('minSize')
    return min ? String(Math.round(Number(min) / (1024 * 1024))) : ''
  })
  const [filterMaxSize, setFilterMaxSize] = useState(() => {
    const max = searchParams.get('maxSize')
    return max ? String(Math.round(Number(max) / (1024 * 1024))) : ''
  })
  const [filterStartDate, setFilterStartDate] = useState(() => {
    const raw = searchParams.get('startDate')
    return raw ? raw.split('T')[0] : ''
  })
  const [filterEndDate, setFilterEndDate] = useState(() => {
    const raw = searchParams.get('endDate')
    return raw ? raw.split('T')[0] : ''
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }
    localStorage.setItem('9drive:theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'))
  }

  async function loadSidebarStats() {
    await Promise.all([
      apiFetch<StorageSummary>('/storage/summary').then(setStorage),
      apiFetch<StorageBreakdown>('/storage/breakdown').then(setBreakdown),
    ])
  }

  async function loadConnectedAccounts() {
    try {
      const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
      setAccounts(data.accounts)
    } catch (e) {
      console.error('Failed to load accounts for filter dropdown', e)
    }
  }

  useEffect(() => {
    setSearchValue(searchParams.get('q') ?? '')
    setFilterKind(searchParams.get('kind') ?? '')
    setFilterAccountId(searchParams.get('accountId') ?? '')
    setFilterMinSize(() => {
      const min = searchParams.get('minSize')
      return min ? String(Math.round(Number(min) / (1024 * 1024))) : ''
    })
    setFilterMaxSize(() => {
      const max = searchParams.get('maxSize')
      return max ? String(Math.round(Number(max) / (1024 * 1024))) : ''
    })
    
    const rawStart = searchParams.get('startDate')
    setFilterStartDate(rawStart ? rawStart.split('T')[0] : '')

    const rawEnd = searchParams.get('endDate')
    setFilterEndDate(rawEnd ? rawEnd.split('T')[0] : '')
  }, [searchParams])

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
    clearAuthSession()
    navigate('/login')
  }

  function applyFilters() {
    const nextParams = new URLSearchParams()
    const activeFolderId = searchParams.get('folderId')
    if (activeFolderId && location.pathname === '/all-files') {
      nextParams.set('folderId', activeFolderId)
    }

    const q = searchValue.trim()
    if (q) nextParams.set('q', q)

    if (filterKind) nextParams.set('kind', filterKind)
    if (filterAccountId) nextParams.set('accountId', filterAccountId)

    if (filterMinSize) {
      const bytes = Number(filterMinSize) * 1024 * 1024
      if (!isNaN(bytes)) nextParams.set('minSize', String(bytes))
    }
    if (filterMaxSize) {
      const bytes = Number(filterMaxSize) * 1024 * 1024
      if (!isNaN(bytes)) nextParams.set('maxSize', String(bytes))
    }

    if (filterStartDate) {
      nextParams.set('startDate', new Date(filterStartDate).toISOString())
    }
    if (filterEndDate) {
      nextParams.set('endDate', new Date(filterEndDate).toISOString())
    }

    setFiltersOpen(false)
    navigate({ pathname: '/all-files', search: nextParams.toString() })
  }

  function clearFilters() {
    setFilterKind('')
    setFilterAccountId('')
    setFilterMinSize('')
    setFilterMaxSize('')
    setFilterStartDate('')
    setFilterEndDate('')
    setFiltersOpen(false)

    const nextParams = new URLSearchParams()
    const activeFolderId = searchParams.get('folderId')
    if (activeFolderId && location.pathname === '/all-files') {
      nextParams.set('folderId', activeFolderId)
    }
    const q = searchValue.trim()
    if (q) nextParams.set('q', q)

    navigate({ pathname: '/all-files', search: nextParams.toString() })
  }

  function searchFiles(event: FormEvent) {
    event.preventDefault()
    applyFilters()
  }

  async function loadRepoUpdates() {
    setUpdatesLoading(true)
    setUpdatesError('')
    try {
      const response = await fetch('https://api.github.com/repos/zenhosta/9drive/commits?per_page=5', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!response.ok) throw new Error(response.status === 403 ? 'GitHub rate limit reached. Try again later.' : 'Failed to load repository updates.')
      const commits = await response.json() as GitHubCommit[]
      setUpdates(commits.map((item) => ({
        sha: item.sha.slice(0, 7),
        title: item.commit.message.split('\n')[0] || 'Repository update',
        author: item.commit.author?.name ?? 'GitHub',
        date: item.commit.author?.date ? formatDate(item.commit.author.date) : '--',
        url: item.html_url,
      })))
      setUpdatesLoaded(true)
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : 'Failed to load repository updates.')
    } finally {
      setUpdatesLoading(false)
    }
  }

  function toggleRepoUpdates() {
    setUpdatesOpen((open) => !open)
    if (!updatesLoaded && !updatesLoading) loadRepoUpdates().catch(() => undefined)
  }

  useEffect(() => {
    apiFetch<{ user: AuthUser }>('/auth/me')
      .then((data) => {
        setUser(data.user)
        updateStoredUser(data.user)
      })
      .catch(() => undefined)
    loadSidebarStats().catch(() => undefined)
    loadConnectedAccounts().catch(() => undefined)
    window.addEventListener('9drive:storage-changed', loadSidebarStats)
    return () => window.removeEventListener('9drive:storage-changed', loadSidebarStats)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setUpdatesOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-white">
      <div className="flex min-h-screen w-full flex-col bg-white lg:h-screen lg:overflow-hidden lg:flex-row">
        <div className="hidden lg:block lg:h-screen lg:shrink-0">
          <Sidebar user={user} storage={storage} breakdown={breakdown} onLogout={logout} />
        </div>
        <div className={cn('fixed inset-0 z-40 bg-slate-950/40 transition-opacity lg:hidden', sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setSidebarOpen(false)} />
        <div className={cn('fixed inset-y-0 left-0 z-50 transform bg-white shadow-2xl transition-transform duration-300 ease-out lg:hidden', sidebarOpen ? 'translate-x-0' : '-translate-x-full')}>
          <div className="absolute right-4 top-4 z-10">
            <Button variant="outline" size="icon" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <Sidebar user={user} storage={storage} breakdown={breakdown} onLogout={logout} onNavigate={() => setSidebarOpen(false)} />
        </div>
        <section className="min-w-0 flex-1 p-4 sm:p-8 lg:h-screen lg:overflow-y-auto lg:p-10">
          <header className="flex w-full min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center justify-between gap-3 lg:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <Button variant="outline" size="icon" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
                <div className="flex min-w-0 items-center gap-2">
                  <BrandLogo className="h-9 w-9 shrink-0" />
                  <span className="truncate text-xl font-extrabold tracking-tight">9Drive</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>
                  {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                </Button>
                <div className="relative shrink-0">
                  <Button variant="outline" size="icon" className="relative" aria-label="Repository updates" aria-expanded={updatesOpen} onClick={toggleRepoUpdates}>
                    <Bell className="h-5 w-5" />
                    {!updatesOpen ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-600" /> : null}
                  </Button>
                  {updatesOpen ? <RepoUpdatesDropdown updates={updates} loading={updatesLoading} error={updatesError} /> : null}
                </div>
              </div>
            </div>
            <div className="relative w-full min-w-0 flex-1 xl:max-w-xl">
              <form onSubmit={searchFiles} className="relative w-full">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <Input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search Documents" className="pl-11 pr-12" />
                <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} className={cn("absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 transition-colors", filtersOpen && "text-blue-600 hover:text-blue-700")} aria-label="Search filters"><SlidersHorizontal className="h-5 w-5" /></button>
              </form>

              {filtersOpen && (
                <div className="absolute left-0 right-0 top-12 z-50 rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <span className="text-sm font-extrabold text-slate-900">Advanced Search Filters</span>
                    <button type="button" onClick={clearFilters} className="text-xs font-bold text-blue-600 hover:text-blue-700">Clear All</button>
                  </div>
                  
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {/* File Kind */}
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">File Type</label>
                      <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none">
                        <option value="">All Types</option>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="pdf">PDF</option>
                        <option value="doc">Document</option>
                        <option value="archive">Archive</option>
                      </select>
                    </div>

                    {/* Connected Account */}
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Connected Account</label>
                      <select value={filterAccountId} onChange={(e) => setFilterAccountId(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none">
                        <option value="">All Accounts</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>{acc.email} ({acc.provider})</option>
                        ))}
                      </select>
                    </div>

                    {/* Size range */}
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Size Range (MB)</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input type="number" placeholder="Min" value={filterMinSize} onChange={(e) => setFilterMinSize(e.target.value)} className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" />
                        <span className="text-slate-400 text-xs font-semibold">to</span>
                        <input type="number" placeholder="Max" value={filterMaxSize} onChange={(e) => setFilterMaxSize(e.target.value)} className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" />
                      </div>
                    </div>

                    {/* Date range */}
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Date Range</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" />
                        <span className="text-slate-400 text-xs font-semibold">to</span>
                        <input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
                    <Button variant="outline" size="sm" type="button" onClick={() => setFiltersOpen(false)}>Cancel</Button>
                    <Button variant="default" size="sm" type="button" onClick={applyFilters}>Apply Filters</Button>
                  </div>
                </div>
              )}
            </div>
             <div className="relative hidden flex-wrap gap-3 lg:flex">
              <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>
                {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </Button>
              <Button variant="outline" size="icon" className="relative" aria-label="Repository updates" aria-expanded={updatesOpen} onClick={toggleRepoUpdates}>
                <Bell className="h-5 w-5" />
                {!updatesOpen ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-600" /> : null}
              </Button>
              {updatesOpen ? <RepoUpdatesDropdown updates={updates} loading={updatesLoading} error={updatesError} /> : null}
            </div>
          </header>
          <Outlet />
        </section>
      </div>
    </main>
  )
}
