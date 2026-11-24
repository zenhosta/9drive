import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import { apiFetch, formatBytes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useTranslation } from '@/lib/i18nContext'

type Account = { id: string; label: string; usedBytes: string; freeBytes: string }
type Move = { id: string; name: string; sizeBytes: string; sourceAccountId: string; targetAccountId: string; status: string; originalDeleted?: boolean; error?: string }
type Job = { id: string; status: string; plan: { deleteOriginals?: boolean; scope: 'managed' | 'all'; accounts: Account[]; projected: Account[]; moves: Move[]; scanned: number; skipped: number; limited: boolean } }
const statusLabels: Record<string, string> = { draft: 'Preview ready', running: 'Transferring', paused: 'Paused', failed: 'Interrupted', completed: 'Completed', cancelled: 'Ended', pending: 'Waiting', copying: 'Copying and verifying' }

export function StorageBalancer({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<'managed' | 'all'>('managed')
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedMoveIds, setSelectedMoveIds] = useState<string[]>([])
  const [deleteOriginals, setDeleteOriginals] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadJob() {
    try {
      const data = await apiFetch<{ job: Job | null }>('/rebalance')
      setJob(data.job)
    } catch {
      setJob(null)
    }
  }

  useEffect(() => { loadJob() }, [])

  useEffect(() => {
    if (job?.status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<{ job: Job | null }>('/rebalance')
        if (data.job) {
          setJob(data.job)
          if (data.job.status !== 'running') { clearInterval(interval); onComplete() }
        }
      } catch {
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [job?.status])

  async function handlePreview() {
    setPreviewLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ job: Job }>('/rebalance/preview', { method: 'POST', body: JSON.stringify({ scope }) })
      setJob(data.job)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to generate preview'))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleStart() {
    if (!job) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ job: Job }>(`/rebalance/${job.id}/start`, { method: 'POST', body: JSON.stringify({ selectedMoveIds, deleteOriginals }) })
      setJob(data.job)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to start redistribution'))
    } finally {
      setLoading(false)
    }
  }

  async function handlePause() {
    if (!job) return
    try {
      const data = await apiFetch<{ job: Job }>(`/rebalance/${job.id}/pause`, { method: 'POST' })
      setJob(data.job)
    } catch {
      setError(t('Failed to pause'))
    }
  }

  async function handleEnd() {
    if (!job) return
    try {
      const data = await apiFetch<{ job: Job }>(`/rebalance/${job.id}/end`, { method: 'POST' })
      setJob(data.job)
    } catch {
      setError(t('Failed to end'))
    }
  }

  function progress() {
    if (!job?.plan) return { done: 0, total: 0 }
    const done = job.plan.moves.filter((m) => m.status === 'completed').length
    return { done, total: job.plan.moves.length }
  }

  if (!job) {
    return (
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2"><Scale className="h-5 w-5" /><h3 className="text-lg font-bold">{t('Storage Rebalancing')}</h3></div>
        <p className="text-slate-500">{t('Connect at least two Google Drive accounts to redistribute files and balance quota usage.')}</p>
        <div className="flex flex-wrap gap-2">
          <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="scope" value="managed" checked={scope === 'managed'} onChange={() => setScope('managed')} className="sr-only peer" /><span className="rounded-lg border border-slate-300 px-3 py-2 peer-checked:border-sky-500 peer-checked:bg-sky-50 peer-checked:text-sky-700 dark:border-slate-700 dark:peer-checked:bg-sky-900/30">{t('Managed (9drive app)')}</span></label>
          <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} className="sr-only peer" /><span className="rounded-lg border border-slate-300 px-3 py-2 peer-checked:border-sky-500 peer-checked:bg-sky-50 peer-checked:text-sky-700 dark:border-slate-700 dark:peer-checked:bg-sky-900/30">{t('All (Complete My Drive)')}</span></label>
        </div>
        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}
        <Button onClick={handlePreview} disabled={previewLoading} className="w-full">{previewLoading ? t('Analyzing...') : t('Generate Preview')}</Button>
      </Card>
    )
  }

  const { done, total } = progress()

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Scale className="h-5 w-5" /><h3 className="text-lg font-bold">{t('Storage Rebalancing')}</h3></div>
        <span className="rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{t(statusLabels[job.status] ?? job.status)}</span>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

      {job.status === 'draft' && job.plan && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {job.plan.accounts.map((acc) => {
              const proj = job.plan.projected.find((p) => p.id === acc.id)
              const used = Number(acc.usedBytes)
              const free = Number(acc.freeBytes)
              const pct = used + free > 0 ? Math.min(100, (used / (used + free)) * 100) : 0
              return (
                <div key={acc.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p className="truncate text-sm font-medium">{acc.label}</p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{t('Used')}: {formatBytes(acc.usedBytes)}</p>
                  {proj && <p className="text-xs text-sky-600 dark:text-sky-400">{t('Projected:')} {formatBytes(proj.usedBytes)}</p>}
                </div>
              )
            })}
          </div>

          <div className="max-h-60 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="w-8 px-3 py-2 text-left"><input type="checkbox" checked={selectedMoveIds.length === job.plan.moves.length && job.plan.moves.length > 0} onChange={(e) => setSelectedMoveIds(e.target.checked ? job.plan.moves.map((m) => m.id) : [])} /></th>
                  <th className="px-3 py-2 text-left">{t('Name')}</th>
                  <th className="px-3 py-2 text-left">{t('Size')}</th>
                  <th className="px-3 py-2 text-left">{t('From')}</th>
                  <th className="px-3 py-2 text-left">{t('To')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {job.plan.moves.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2"><input type="checkbox" checked={selectedMoveIds.includes(m.id)} onChange={(e) => setSelectedMoveIds(e.target.checked ? [...selectedMoveIds, m.id] : selectedMoveIds.filter((id) => id !== m.id))} /></td>
                    <td className="max-w-xs truncate px-3 py-2">{m.name}</td>
                    <td className="px-3 py-2">{formatBytes(m.sizeBytes)}</td>
                    <td className="px-3 py-2 text-xs">{job.plan.accounts.find((a) => a.id === m.sourceAccountId)?.label}</td>
                    <td className="px-3 py-2 text-xs">{job.plan.accounts.find((a) => a.id === m.targetAccountId)?.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deleteOriginals} onChange={(e) => setDeleteOriginals(e.target.checked)} /> {t('Delete originals after verified copy')}</label>
            <span className="text-xs text-slate-500">{selectedMoveIds.length}/{total} {t('files selected')}</span>
          </div>

          <Button onClick={handleStart} disabled={loading || selectedMoveIds.length === 0} className="w-full">{loading ? t('Starting...') : t('Start Redistribution')}</Button>
        </div>
      )}

      {['running', 'paused', 'failed'].includes(job.status) && job.plan && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span>{t('Progress:')} <strong>{done}/{total}</strong></span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full bg-sky-500 transition-all" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} /></div>
          </div>
          <div className="max-h-60 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 text-left">{t('Name')}</th>
                  <th className="px-3 py-2 text-left">{t('Size')}</th>
                  <th className="px-3 py-2 text-left">{t('Status')}</th>
                  <th className="px-3 py-2 text-left">{t('Error')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {job.plan.moves.map((m) => (
                  <tr key={m.id}>
                    <td className="max-w-xs truncate px-3 py-2">{m.name}</td>
                    <td className="px-3 py-2">{formatBytes(m.sizeBytes)}</td>
                    <td className="px-3 py-2 capitalize">{t(statusLabels[m.status] ?? m.status)}</td>
                    <td className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{m.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            {job.status === 'running' && <Button variant="outline" onClick={handlePause}>{t('Pause')}</Button>}
            {job.status === 'paused' && <Button onClick={handleStart}>{t('Resume')}</Button>}
            {['paused', 'failed'].includes(job.status) && <Button variant="danger" onClick={handleEnd}>{t('End')}</Button>}
          </div>
        </div>
      )}

      {job.status === 'completed' && (
        <div className="py-4 text-center">
          <Scale className="mx-auto h-12 w-12 text-green-500" />
          <h4 className="mt-2 font-bold">{t('Redistribution completed')}</h4>
          <p className="text-sm text-slate-500">{total} {t('files moved')}</p>
          <Button variant="outline" className="mt-4" onClick={onComplete}>{t('New redistribution')}</Button>
        </div>
      )}

      {job.status === 'cancelled' && (
        <div className="py-4 text-center">
          <p className="text-slate-500">{t('Redistribution ended')}</p>
          <Button variant="outline" className="mt-4" onClick={onComplete}>{t('New redistribution')}</Button>
        </div>
      )}
    </Card>
  )
}
