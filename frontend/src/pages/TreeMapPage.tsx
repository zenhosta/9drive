import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, Folder, FolderTree, FileArchive, FileImage, FilePlay, Gauge, Workflow } from 'lucide-react'
import { apiFetch, formatBytes } from '@/lib/api'
import { cn } from '@/lib/utils'

type BackendFolder = { id: string; name: string; parentId?: string | null; updatedAt: string }
type BackendFile = { id: string; name: string; sizeBytes: string; mimeType: string; folderId?: string | null }

const fileKind = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'other'
}

const edgeColors = ['#a78bfa', '#22d3ee', '#f472b6', '#34d399']

export function TreeMapPage() {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<BackendFolder[]>([])
  const [files, setFiles] = useState<BackendFile[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [folderData, fileData] = await Promise.all([
          apiFetch<{ folders: BackendFolder[] }>('/folders?all=1'),
          apiFetch<{ files: BackendFile[] }>('/files'),
        ])
        if (!active) return
        setFolders(folderData.folders)
        setFiles(fileData.files)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load the folder map')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const roots = useMemo(() => folders.filter((folder) => !folder.parentId).slice(0, 4), [folders])
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + Number(file.sizeBytes || 0), 0), [files])
  const nestedCount = folders.filter((folder) => folder.parentId).length

  // Compute type breakdown
  const typeCounts = useMemo(() => {
    const counts = { image: 0, video: 0, pdf: 0, other: 0 }
    files.forEach((file) => {
      const kind = fileKind(file.mimeType)
      counts[kind] = (counts[kind] || 0) + 1
    })
    return counts
  }, [files])

  const nodes = roots.map((folder, index) => {
    const y = roots.length === 1 ? 50 : 18 + (64 / Math.max(1, roots.length - 1)) * index
    return { folder, x: 78, y, color: edgeColors[index % edgeColors.length] }
  })

  return (
    <div className="pb-4">
      {error ? (
        <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <span className="chip chip-active">
          <Workflow className="h-4 w-4" /> Logic Map
        </span>
        <button type="button" className="chip" onClick={() => navigate('/all-files')}>
          <Folder className="h-4 w-4" /> Files
        </button>
      </div>

      <section className="glass-card relative mt-4 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(167,139,250,0.35)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative h-[380px] w-full sm:h-[440px]">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {nodes.map((node) => (
              <g key={node.folder.id}>
                <path
                  d={`M 30 50 C 48 50, 56 ${node.y}, ${node.x - 8} ${node.y}`}
                  fill="none"
                  stroke={node.color}
                  strokeWidth="0.6"
                  strokeLinecap="round"
                  opacity="0.85"
                />
                <circle cx={node.x - 8} cy={node.y} r="1" fill={node.color} />
              </g>
            ))}
          </svg>

          {/* Root */}
          <div className="absolute left-[6%] top-1/2 w-[38%] -translate-y-1/2">
            <div className="rounded-3xl border border-violet-400/30 bg-[#0d1020]/90 p-4 shadow-[0_0_40px_-12px_rgba(167,139,250,0.6)] backdrop-blur-xl">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/15">
                <Cloud className="h-5 w-5 text-violet-300" />
              </span>
              <p className="mt-3 truncate text-sm font-bold text-white">9Drive Core</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Root</p>
            </div>
          </div>

          {/* Folder nodes */}
          {nodes.map((node) => (
            <button
              key={node.folder.id}
              type="button"
              onClick={() => navigate(`/all-files?folderId=${node.folder.id}`)}
              style={{ top: `${node.y}%`, borderColor: `${node.color}55` }}
              className="absolute right-[3%] w-[12.5rem] max-w-[42%] -translate-y-1/2 rounded-3xl border bg-[#0b0d16]/90 p-3.5 text-left backdrop-blur-xl transition-transform active:scale-95"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: `${node.color}22`, border: `1px solid ${node.color}55` }}
              >
                <Folder className="h-4 w-4" style={{ color: node.color }} />
              </span>
              <p className="mt-2 truncate text-[13px] font-semibold text-white">{node.folder.name}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                {folders.filter((f) => f.parentId === node.folder.id).length} subfolders
              </p>
            </button>
          ))}

          {nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <FolderTree className="h-8 w-8 text-violet-300" />
              <p className="text-sm font-semibold text-white">Your map is empty</p>
              <p className="text-xs text-[var(--text-secondary)]">Create a folder in Files and it will appear here.</p>
            </div>
          ) : null}

          <div className="absolute inset-x-4 bottom-4 flex items-center gap-4 rounded-full border border-white/8 bg-black/40 px-4 py-2 text-[11px] text-[var(--text-secondary)] backdrop-blur">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> Live map</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> Active node</span>
          </div>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/15">
            <FolderTree className="h-4 w-4 text-violet-300" />
          </span>
          <p className="mt-3 text-2xl font-bold text-white">{folders.length}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Folders · {nestedCount} nested
          </p>
        </div>
        <div className="glass-card p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/15">
            <Gauge className="h-4 w-4 text-cyan-300" />
          </span>
          <p className="mt-3 text-2xl font-bold text-cyan-300">{formatBytes(totalBytes)}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">{files.length} files mapped</p>
        </div>
      </div>      {/* Type breakdown dashboard */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15">
            <FileImage className="h-4 w-4" />
          </span>
          <p className="mt-3 text-2xl font-bold text-white">{typeCounts.image ?? 0}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">Image</p>
        </div>
        <div className="glass-card p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
            <FilePlay className="h-4 w-4" />
          </span>
          <p className="mt-3 text-2xl font-bold text-white">{typeCounts.video ?? 0}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">Video</p>
        </div>
        <div className="glass-card p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
            <FileArchive className="h-4 w-4" />
          </span>
          <p className="mt-3 text-2xl font-bold text-white">{typeCounts.pdf ?? 0}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">PDF</p>
        </div>
        <div className="glass-card p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-500/15">
            <Folder className="h-4 w-4" />
          </span>
          <p className="mt-3 text-2xl font-bold text-white">{typeCounts.other ?? 0}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">Other</p>
        </div>
      </div>

      <p className={cn('mt-4 text-center text-[11px] text-[var(--text-secondary)]')}>        Tap any node to open that folder in Files.
      </p>
    </div>
  )
}

