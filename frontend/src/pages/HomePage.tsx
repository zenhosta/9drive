import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  Clock,
  Cloud,
  FileArchive,
  FileImage,
  FilePlay,
  Folder,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

type StorageSummary = { totalBytes: string; usedBytes: string; availableBytes: string }
type StorageBreakdown = { photo: string; video: string; document: string }
type BackendFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  createdAt: string
  folder?: { id: string; name: string } | null
}
type BackendFolder = { id: string; name: string; color: string; updatedAt: string }

function fileKind(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'other'
}

function KindIcon({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'image') return <FileImage className={className} />
  if (kind === 'video') return <FilePlay className={className} />
  if (kind === 'pdf') return <FileArchive className={className} />
  return <Folder className={className} />
}

const quickActions = [
  { label: 'Upload', href: '/all-files', icon: Upload, tone: 'text-emerald-300' },
  { label: 'Recent', href: '/recent', icon: Clock, tone: 'text-amber-300' },
  { label: 'Shared', href: '/shared', icon: Share2, tone: 'text-cyan-300' },
  { label: 'Trash', href: '/trash', icon: Trash2, tone: 'text-rose-300' },
]

export function HomePage() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [breakdown, setBreakdown] = useState<StorageBreakdown>({ photo: '0', video: '0', document: '0' })
  const [files, setFiles] = useState<BackendFile[]>([])
  const [folders, setFolders] = useState<BackendFolder[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [summaryData, breakdownData, fileData, folderData] = await Promise.all([
          apiFetch<StorageSummary>('/storage/summary'),
          apiFetch<StorageBreakdown>('/storage/breakdown'),
          apiFetch<{ files: BackendFile[] }>('/files'),
          apiFetch<{ folders: BackendFolder[] }>('/folders?all=1'),
        ])
        if (!active) return
        setSummary(summaryData)
        setBreakdown(breakdownData)
        setFiles(fileData.files)
        setFolders(folderData.folders)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      }
    }
    load()
    const refresh = () => load()
    window.addEventListener('9drive:storage-changed', refresh)
    return () => {
      active = false
      window.removeEventListener('9drive:storage-changed', refresh)
    }
  }, [])

  const used = Number(summary?.usedBytes ?? 0)
  const total = Number(summary?.totalBytes ?? 0)
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0

  const recentFiles = useMemo(
    () => [...files].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5),
    [files],
  )

  const categories = [
    { label: 'Photos', value: breakdown.photo, dot: 'bg-emerald-400' },
    { label: 'Media', value: breakdown.video, dot: 'bg-amber-400' },
    { label: 'Docs', value: breakdown.document, dot: 'bg-cyan-400' },
  ]

  const circumference = 2 * Math.PI * 46
  const dash = (percent / 100) * circumference

  return (
    <div className="pb-4">
      {error ? (
        <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
      ) : null}

      {/* Storage quota card */}
      <section className="glass-card mt-3 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Storage Quota</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Cloud className="h-4 w-4 text-emerald-400" /> Google Drive synchronized
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
            {total > 0 ? `${percent}% used` : 'No drive'}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative mx-auto h-36 w-36 shrink-0">
            <svg viewBox="0 0 110 110" className="h-36 w-36 -rotate-90">
              <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
              <circle
                cx="55"
                cy="55"
                r="46"
                fill="none"
                stroke="url(#quotaGradient)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference}`}
                className="glow-ring transition-all duration-700"
              />
              <defs>
                <linearGradient id="quotaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4ade80" />
                  <stop offset="60%" stopColor="#2fe0a3" />
                  <stop offset="100%" stopColor="#f6c453" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-white">{percent}%</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {formatBytes(summary?.usedBytes)} used
              </span>
            </div>
          </div>

          <div className="grid flex-1 gap-2.5">
            {categories.map((category) => (
              <div key={category.label} className="glass-soft flex items-center justify-between px-4 py-3">
                <span className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]">
                  <span className={cn('h-2 w-2 rounded-full', category.dot)} />
                  {category.label}
                </span>
                <span className="text-sm font-bold text-white">{formatBytes(category.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/6 pt-4 text-sm">
          <span className="text-[var(--text-secondary)]">
            {formatBytes(summary?.availableBytes)} available of {formatBytes(summary?.totalBytes)}
          </span>
          <Link to="/quota" className="flex items-center gap-1 font-semibold text-emerald-300 hover:text-emerald-200">
            Manage <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Quick actions */}
      <div className="mt-5 grid grid-cols-4 gap-2.5 sm:gap-4">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.href)}
            className="glass-card flex flex-col items-center gap-2 px-2 py-4 transition-transform active:scale-95"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/8 bg-white/5">
              <action.icon className={cn('h-6 w-6', action.tone)} />
            </span>
            <span className="text-xs font-semibold text-[var(--text-primary)]">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Folders */}
      <div className="mt-7 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Folders</h2>
        <Link to="/all-files" className="text-sm font-semibold text-emerald-300 hover:text-emerald-200">
          View all
        </Link>
      </div>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
        {folders.slice(0, 6).map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => navigate(`/all-files?folderId=${folder.id}`)}
            className="glass-card min-w-[9.5rem] shrink-0 p-4 text-left transition-transform active:scale-95"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10">
              <Folder className="h-5 w-5 text-amber-300" />
            </span>
            <p className="mt-3 truncate text-sm font-semibold text-white">{folder.name}</p>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{formatDate(folder.updatedAt)}</p>
          </button>
        ))}
        {folders.length === 0 ? (
          <Link to="/all-files" className="glass-soft flex min-w-[9.5rem] shrink-0 flex-col items-start gap-2 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10">
              <Folder className="h-5 w-5 text-emerald-300" />
            </span>
            <p className="text-sm font-semibold text-white">Create your first folder</p>
            <p className="text-[11px] text-[var(--text-secondary)]">Organise your drive</p>
          </Link>
        ) : null}
      </div>

      {/* Recent files */}
      <div className="mt-7 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Recent Files</h2>
        <Link to="/recent" className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-white">
          Modified
        </Link>
      </div>
      <div className="mt-3 grid gap-2.5">
        {recentFiles.map((file) => {
          const kind = fileKind(file.mimeType)
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => navigate('/all-files')}
              className="glass-card flex items-center gap-3.5 px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5">
                <KindIcon kind={kind} className={cn('h-5 w-5', kind === 'image' ? 'text-emerald-300' : kind === 'video' ? 'text-amber-300' : kind === 'pdf' ? 'text-cyan-300' : 'text-slate-300')} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{file.name}</span>
                <span className="mt-0.5 block text-[11px] text-[var(--text-secondary)]">
                  {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
            </button>
          )
        })}
        {recentFiles.length === 0 ? (
          <Link to="/all-files" className="glass-card flex items-center justify-between px-4 py-6">
            <span className="text-sm text-[var(--text-secondary)]">No files yet — upload something to get started.</span>
            <Upload className="h-5 w-5 text-emerald-300" />
          </Link>
        ) : null}
      </div>
    </div>
  )
}
