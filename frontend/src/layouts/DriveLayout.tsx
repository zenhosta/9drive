import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell,
  FileArchive,
  Gauge,
  LogOut,
  Menu,
  MoreVertical,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { BrandLogo } from '@/components/drive/BrandLogo'
import { Input } from '@/components/ui/input'
import { apiFetch, formatBytes } from '@/lib/api'
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
  photo: number
  video: number
  document: number
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(getStoredUser())
  const [storage, setStorage] = useState<StorageSummary | null>(null)
  const [breakdown, setBreakdown] = useState<StorageBreakdown>({ photo: 0, video: 0, document: 0 })

  async function loadSidebarStats() {
    await Promise.all([
      apiFetch<StorageSummary>('/storage/summary').then(setStorage),
      apiFetch<{ files: Array<{ mimeType: string; sizeBytes: string }> }>('/files').then((data) => {
        const next = { photo: 0, video: 0, document: 0 }
        for (const file of data.files) {
          const size = Number(file.sizeBytes)
          if (file.mimeType.startsWith('image/')) next.photo += size
          else if (file.mimeType.startsWith('video/')) next.video += size
          else next.document += size
        }
        setBreakdown(next)
      }),
    ])
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

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
    clearAuthSession()
    navigate('/login')
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="flex min-h-screen flex-col bg-white lg:h-screen lg:overflow-hidden lg:flex-row">
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
        <section className="flex-1 p-5 sm:p-8 lg:h-screen lg:overflow-y-auto lg:p-10">
          <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3 lg:hidden">
              <Button variant="outline" size="icon" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <BrandLogo className="h-9 w-9" />
                <span className="text-xl font-extrabold tracking-tight">9Drive</span>
              </div>
            </div>
            <div className="relative max-w-xl flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <Input placeholder="Search Folder, Document, Etc" className="pl-11 pr-12" />
              <SlidersHorizontal className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="icon" aria-label="Notifications"><Bell className="h-5 w-5" /></Button>
            </div>
          </header>
          <Outlet />
        </section>
      </div>
    </main>
  )
}
