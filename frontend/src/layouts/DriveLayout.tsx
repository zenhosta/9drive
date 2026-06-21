import { type FormEvent, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bell,
  Braces,
  FileArchive,
  Gauge,
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
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
    <aside className="flex h-full w-72 flex-col border-slate-200 bg-white p-5 lg:border-r">
      <div className="flex items-center gap-3 pb-5">
        <BrandLogo />
        <span className="text-2xl font-extrabold tracking-tight">9Drive</span>
      </div>

      <div className="flex items-center gap-3 border-y border-slate-200 py-5">
        <img src={profileImageUrl} alt="User avatar" className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{user?.name ?? 'User'}</p>
          <p className="truncate text-sm text-slate-500">{user?.email ?? 'Loading...'}</p>
        </div>
        <MoreVertical className="h-5 w-5 text-slate-500" />
      </div>

      <nav className="mt-6 grid gap-2">
        {menu.map((item) => item.disabled ? (
          <button key={item.label} type="button" disabled className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-xl px-4 text-sm font-semibold text-slate-400 opacity-70">
            <item.icon className="h-5 w-5" />
            {item.label}
          </button>
        ) : (
          <NavLink key={item.label} to={item.href} onClick={onNavigate} className={({ isActive }) => cn('inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all', isActive ? 'bg-slate-100 text-slate-950 shadow-sm' : 'text-slate-700 hover:bg-slate-100')}>
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-5 border-t border-slate-200 pt-5">
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => cn('inline-flex h-11 w-full items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all', isActive ? 'bg-slate-100 text-slate-950 shadow-sm' : 'text-slate-700 hover:bg-slate-100')}>
          <Settings className="h-5 w-5" />Setting
        </NavLink>
        <NavLink to="/api" onClick={onNavigate} className={({ isActive }) => cn('mt-2 inline-flex h-11 w-full items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all', isActive ? 'bg-slate-100 text-slate-950 shadow-sm' : 'text-slate-700 hover:bg-slate-100')}>
          <Braces className="h-5 w-5" />API
        </NavLink>
      </div>

      <Card className="mt-6 p-4 lg:mt-auto">
        {items.map(([label, value, color]) => (
          <div key={label} className="mb-3 flex items-center justify-between text-sm">
            <span className="flex items-center gap-3"><span className={cn('h-4 w-4 rounded', color)} />{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
        <div className="mt-4 border-t border-slate-200 pt-4 text-sm">
          <p><b>{formatBytes(storage?.usedBytes)}</b> used of <span className="text-slate-500">{formatBytes(storage?.totalBytes)}</span></p>
          <div className="my-3 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} /></div>
          <Button variant="danger" className="mt-4 w-full justify-start" onClick={onLogout}><LogOut className="h-5 w-5" />Log Out</Button>
        </div>
      </Card>
    </aside>
  )
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

  useEffect(() => {
    setSearchValue(searchParams.get('q') ?? '')
  }, [searchParams])

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
    clearAuthSession()
    navigate('/login')
  }

  function searchFiles(event: FormEvent) {
    event.preventDefault()
    const nextParams = new URLSearchParams(location.pathname === '/all-files' ? searchParams : undefined)
    const query = searchValue.trim()
    if (query) nextParams.set('q', query)
    else nextParams.delete('q')
    navigate({ pathname: '/all-files', search: nextParams.toString() })
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
            <form onSubmit={searchFiles} className="relative w-full min-w-0 flex-1 xl:max-w-xl">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <Input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search Documents" className="pl-11 pr-12" />
              <button type="submit" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" aria-label="Search files"><SlidersHorizontal className="h-5 w-5" /></button>
            </form>
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
