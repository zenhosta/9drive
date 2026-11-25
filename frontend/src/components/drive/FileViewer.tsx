import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react'
import { API_URL, apiFetch, formatBytes } from '@/lib/api'
import { downloadIndexedFile, googleDriveLink, type IndexedRow } from '@/components/drive/drive-bits'

type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'none'

export function previewKind(f: Pick<IndexedRow, 'category' | 'mimeType'>): Kind {
  if (f.category === 'images' || f.mimeType.startsWith('image/')) return 'image'
  if (f.category === 'videos' || f.mimeType.startsWith('video/')) return 'video'
  if (f.category === 'audio' || f.mimeType.startsWith('audio/')) return 'audio'
  // Google Docs/Sheets/Slides/Drawings are shown as a PDF export.
  if (f.mimeType === 'application/pdf' || /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/.test(f.mimeType)) return 'pdf'
  return 'none'
}

export const canPreview = (f: Pick<IndexedRow, 'category' | 'mimeType'>) => previewKind(f) !== 'none'

/** Full-screen viewer for images, video, audio and PDFs, with previous/next across the files on the page. */
export function FileViewer({ files, index, onIndex, onClose }: { files: IndexedRow[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const file = files[index]
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const kind = file ? previewKind(file) : 'none'

  const go = useCallback((delta: number) => {
    if (files.length < 2) return
    onIndex((index + delta + files.length) % files.length)
  }, [files.length, index, onIndex])

  useEffect(() => {
    setSrc(null)
    setFailed(false)
    if (!file || kind === 'none') return undefined
    let cancelled = false
    apiFetch<{ path: string }>(`/drive-index/${file.id}/view-url`)
      .then((r) => { if (!cancelled) setSrc(`${API_URL}${r.path}`) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [file, kind])

  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  if (!file) return null
  const btn = 'viewer-btn inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'
  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label={`Preview of ${file.name}`} tabIndex={-1} className="viewer on-accent fixed inset-0 z-[75] flex flex-col bg-black outline-none">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold" title={file.name}>{file.name}</p>
          <p className="text-xs opacity-80">{index + 1} of {files.length} · {formatBytes(file.sizeBytes)} · {file.connectedAccount.email}</p>
        </div>
        <button type="button" className={btn} onClick={() => downloadIndexedFile(file.id, file.name).catch(() => undefined)}><Download className="h-4 w-4" aria-hidden />Download</button>
        <a className={btn} href={googleDriveLink(file)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" aria-hidden />Open in Google Drive</a>
        <button type="button" className={btn} onClick={onClose} aria-label="Close preview"><X className="h-4 w-4" aria-hidden />Close</button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        {files.length > 1 ? <button type="button" aria-label="Previous file" className={`${btn} absolute left-3 top-1/2 h-12 w-12 -translate-y-1/2 justify-center`} onClick={() => go(-1)}><ChevronLeft className="h-6 w-6" aria-hidden /></button> : null}
        {kind === 'none' || failed ? (
          <div className="max-w-md text-center">
            <p className="text-lg font-bold">{failed ? 'This file could not be loaded.' : 'No preview for this kind of file.'}</p>
            <p className="mt-2 text-sm opacity-80">Use Download, or open it in Google Drive.</p>
          </div>
        ) : !src ? (
          <p role="status" className="text-sm opacity-80">Loading…</p>
        ) : kind === 'image' ? (
          <img key={src} src={src} alt={file.name} className="max-h-full max-w-full rounded-lg object-contain" onError={() => setFailed(true)} />
        ) : kind === 'video' ? (
          <video key={src} src={src} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" onError={() => setFailed(true)} />
        ) : kind === 'audio' ? (
          <audio key={src} src={src} controls autoPlay onError={() => setFailed(true)} />
        ) : (
          <iframe key={src} src={src} title={file.name} className="h-full w-full max-w-5xl rounded-lg bg-white" />
        )}
        {files.length > 1 ? <button type="button" aria-label="Next file" className={`${btn} absolute right-3 top-1/2 h-12 w-12 -translate-y-1/2 justify-center`} onClick={() => go(1)}><ChevronRight className="h-6 w-6" aria-hidden /></button> : null}
      </div>
    </div>
  )
}
