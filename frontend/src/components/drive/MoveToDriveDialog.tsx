import { useEffect, useMemo, useState } from 'react'
import { Cloud, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { useJobs } from '@/context/JobsContext'
import { apiFetch, formatBytes } from '@/lib/api'
import { usageBarClass, usageLevel, usagePercent } from '@/lib/storage-thresholds'
import { cn } from '@/lib/utils'

export type MovableFile = { id: string; name: string; mimeType?: string; sizeBytes?: string; accountId?: string }
type OverviewAccount = { id: string; provider: string; email: string; displayName: string | null; totalBytes: string | null; usedBytes: string; availableBytes: string | null; unlimited: boolean }
type MoveResponse = { jobId: string; accepted: number; skipped: Array<{ fileId: string; name: string; reason: string }>; warnings: string[] }

const MARGIN = 100 * 1024 * 1024
const isNative = (mime?: string) => Boolean(mime?.startsWith('application/vnd.google-apps.') && mime !== 'application/vnd.google-apps.folder')

export function MoveToDriveDialog({ open, files, preselectSourceAccountId, onClose, onStarted }: { open: boolean; files: MovableFile[]; preselectSourceAccountId?: string; onClose: () => void; onStarted?: (jobId: string) => void }) {
  const { refresh } = useJobs()
  const [accounts, setAccounts] = useState<OverviewAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [includeNative, setIncludeNative] = useState(false)
  const [nativeFormat, setNativeFormat] = useState<'native' | 'office'>('native')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<MoveResponse | null>(null)

  useEffect(() => {
    if (!open) return
    setError('')
    setResult(null)
    setIncludeNative(false)
    setLoading(true)
    apiFetch<{ accounts: OverviewAccount[] }>('/storage/overview')
      .then((data) => setAccounts(data.accounts.filter((a) => a.provider === 'google_drive')))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load drives'))
      .finally(() => setLoading(false))
  }, [open])

  const nativeCount = files.filter((f) => isNative(f.mimeType)).length
  const movable = useMemo(() => files.filter((f) => includeNative || !isNative(f.mimeType)), [files, includeNative])

  const rows = useMemo(() => accounts.map((account) => {
    const toMove = movable.filter((f) => f.accountId !== account.id)
    const bytes = toMove.reduce((sum, f) => sum + (isNative(f.mimeType) ? 0 : Number(f.sizeBytes ?? 0)), 0)
    const free = account.availableBytes === null ? Infinity : Number(account.availableBytes)
    const allHere = movable.length > 0 && toMove.length === 0
    const fits = free >= bytes + MARGIN
    return { account, bytes, free, allHere, fits, disabled: allHere || !fits }
  }), [accounts, movable])

  useEffect(() => {
    if (!open || rows.length === 0) return
    if (targetId && rows.some((r) => r.account.id === targetId && !r.disabled)) return
    const best = rows.filter((r) => !r.disabled && r.account.id !== preselectSourceAccountId).sort((a, b) => b.free - a.free)[0]
    setTargetId(best?.account.id ?? '')
  }, [open, rows, targetId, preselectSourceAccountId])

  async function submit() {
    if (!targetId) return
    setSubmitting(true)
    setError('')
    try {
      const data = await apiFetch<MoveResponse>('/files/move-to-account', { method: 'POST', body: JSON.stringify({ fileIds: files.map((f) => f.id), targetAccountId: targetId, includeNative, nativeFormat }) })
      await refresh()
      onStarted?.(data.jobId)
      if (data.skipped.length === 0 && data.warnings.length === 0) onClose()
      else setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the move')
    } finally {
      setSubmitting(false)
    }
  }

  const totalBytes = movable.reduce((sum, f) => sum + (isNative(f.mimeType) ? 0 : Number(f.sizeBytes ?? 0)), 0)

  return (
    <DummyModal
      open={open}
      title="Move to drive"
      description={files.length === 1 ? files[0].name : `${files.length} files · ${formatBytes(totalBytes)}`}
      onClose={onClose}
      className="sm:max-w-lg"
    >
      {result ? (
        <div className="grid gap-4">
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Move started for {result.accepted} file{result.accepted === 1 ? '' : 's'}. Progress is shown at the bottom left and on the Jobs page.</p>
          {result.warnings.map((w) => <p key={w} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{w}</p>)}
          {result.skipped.length > 0 ? (
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-bold">{result.skipped.length} skipped</p>
              <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4">{result.skipped.map((s) => <li key={s.fileId}><b>{s.name}</b>: {s.reason}</li>)}</ul>
            </div>
          ) : null}
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="grid gap-4">
          {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          {loading ? <div className="grid gap-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div> : (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">Choose the destination drive</legend>
              {rows.map(({ account, bytes, free, allHere, fits, disabled }) => {
                const percent = usagePercent(account.usedBytes, account.totalBytes)
                const Icon = account.provider === 's3' ? Database : Cloud
                return (
                  <label key={account.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm', targetId === account.id ? 'border-blue-500 bg-blue-50/60' : 'border-slate-200', disabled && 'cursor-not-allowed opacity-50')}>
                    <input type="radio" name="target-drive" className="h-4 w-4" checked={targetId === account.id} disabled={disabled} onChange={() => setTargetId(account.id)} />
                    <Icon className="h-5 w-5 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{account.displayName && account.displayName !== account.email ? `${account.displayName} · ` : ''}{account.email}</p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', usageBarClass[usageLevel(percent)])} style={{ width: `${percent}%` }} /></div>
                      <p className="mt-1 text-xs text-slate-500">{free === Infinity ? 'Unlimited' : `${formatBytes(free)} free`}{allHere ? ' · files already here' : !fits ? ` · not enough space for ${formatBytes(bytes)}` : ''}</p>
                    </div>
                  </label>
                )
              })}
              {rows.length === 0 ? <p className="text-sm text-slate-500">No Google Drive accounts connected.</p> : null}
            </fieldset>
          )}

          {nativeCount > 0 ? (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              <label className="flex items-start gap-2 font-semibold"><input type="checkbox" className="mt-0.5" checked={includeNative} onChange={(e) => setIncludeNative(e.target.checked)} />Also move {nativeCount} Google Doc/Sheet/Slide file{nativeCount === 1 ? '' : 's'}</label>
              <p className="mt-1.5 opacity-90">These are exported and re-uploaded, so they get a new Drive file ID and lose Google revision history, comments and Google-side sharing (limit about 10 MB each). They use little or no quota, so this frees almost no space. 9Drive keeps the name, folder and share links.</p>
              {includeNative ? (
                <label className="mt-2 flex items-center gap-2">Save as
                  <select className="h-8 rounded-lg border border-amber-200 bg-white px-2" value={nativeFormat} onChange={(e) => setNativeFormat(e.target.value as 'native' | 'office')}>
                    <option value="native">Editable Google format</option>
                    <option value="office">Office file (.docx, .xlsx, .pptx)</option>
                  </select>
                </label>
              ) : <p className="mt-1.5 font-semibold">Skipped by default.</p>}
            </div>
          ) : null}

          <p className="text-xs text-slate-500">Each file is copied, verified, and only then deleted from its current drive. If anything fails the original stays where it is.</p>
          <div className="grid gap-3 sm:flex sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={!targetId || submitting || movable.length === 0}>{submitting ? 'Starting...' : `Move ${movable.length} file${movable.length === 1 ? '' : 's'}`}</Button>
          </div>
        </div>
      )}
    </DummyModal>
  )
}
