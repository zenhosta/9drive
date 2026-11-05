import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { useJobs } from '@/context/JobsContext'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { isActiveJob, itemStatusLabel, jobPercent, jobStatusLabel, type MoveJob, type MoveJobItem } from '@/lib/jobs'
import { cn } from '@/lib/utils'

type Detail = { job: MoveJob; items: MoveJobItem[]; accounts: Array<{ id: string; email: string }> }

const statusTone: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-600',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 t-ok',
  completed_with_errors: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 t-bad',
  cancelled: 'bg-slate-100 text-slate-600',
  done: 'bg-emerald-100 t-ok',
  skipped: 'bg-slate-100 text-slate-600',
}

function Chip({ status, label }: { status: string; label: string }) {
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', statusTone[status] ?? statusTone.queued)}>{label}</span>
}

function JobCard({ job, onChanged }: { job: MoveJob; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = isActiveJob(job)

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await apiFetch<Detail>(`/jobs/${job.id}?limit=200`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load details')
    }
  }, [job.id])

  useEffect(() => {
    if (open) loadDetail()
  }, [open, loadDetail, job.doneItems, job.failedItems, job.status])

  async function act(path: 'cancel' | 'retry') {
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/jobs/${job.id}/${path}`, { method: 'POST' })
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const emailOf = (id: string) => detail?.accounts.find((a) => a.id === id)?.email ?? 'drive'
  const canRetry = !active && job.failedItems > 0 && !job.cancelRequested

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <p className="font-extrabold">{job.type === 'rebalance' ? 'Rebalance' : job.type === 'copy' ? 'Copy' : job.type === 'delete' ? 'Delete' : 'Move'} · {job.totalItems} file{job.totalItems === 1 ? '' : 's'} · {formatBytes(job.totalBytes)}</p>
            <p className="text-xs text-slate-500">Started {formatDate(job.createdAt)}{job.finishedAt ? ` · finished ${formatDate(job.finishedAt)}` : ''}</p>
          </div>
        </button>
        <Chip status={job.status} label={jobStatusLabel[job.status]} />
        {active ? <Button variant="outline" size="sm" onClick={() => act('cancel')} disabled={busy}><XCircle className="h-4 w-4" />Cancel</Button> : null}
        {canRetry ? <Button variant="outline" size="sm" onClick={() => act('retry')} disabled={busy}><RotateCcw className="h-4 w-4" />Retry {job.failedItems} failed</Button> : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Job progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={jobPercent(job)}>
        <div className={cn('h-full rounded-full transition-all', job.failedItems > 0 ? 'bg-amber-400' : 'bg-blue-600')} style={{ width: `${jobPercent(job)}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">{job.doneItems} moved · {job.failedItems} failed · {formatBytes(job.movedBytes)} transferred</p>
      {error ? <p role="alert" className="mt-2 text-xs t-bad">{error}</p> : null}

      {open ? (
        <div className="mt-4 overflow-x-auto">
          {!detail ? <div className="h-16 animate-pulse rounded-xl bg-slate-100" /> : (
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3 font-semibold">File</th><th className="py-2 pr-3 font-semibold">Size</th><th className="py-2 pr-3 font-semibold">{job.type === 'delete' ? 'Drive' : 'To'}</th><th className="py-2 font-semibold">Status</th></tr></thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 align-top">
                    <td className="max-w-[16rem] truncate py-2 pr-3 font-semibold" title={item.fileName}>{item.fileName}</td>
                    <td className="py-2 pr-3 text-slate-500">{formatBytes(item.bytes)}</td>
                    <td className="max-w-[12rem] truncate py-2 pr-3 text-slate-500" title={emailOf(item.targetAccountId)}>{job.type === 'delete' ? emailOf(item.sourceAccountId) : emailOf(item.targetAccountId)}</td>
                    <td className="py-2">
                      <Chip status={item.status} label={itemStatusLabel[item.status]} />
                      {item.error ? <p className="mt-1 text-xs t-bad">{item.error}</p> : null}
                      {item.note ? <p className="mt-1 text-xs t-warn">{item.note}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail && job.totalItems > detail.items.length ? <p className="mt-2 text-xs text-slate-500">Showing the {detail.items.length} most recently updated of {job.totalItems} files.</p> : null}
        </div>
      ) : null}
    </Card>
  )
}

export function JobsPage() {
  const { finishedVersion, activeJobs } = useJobs()
  const [jobs, setJobs] = useState<MoveJob[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setJobs((await apiFetch<{ jobs: MoveJob[] }>('/jobs?limit=50')).jobs)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, finishedVersion])

  useEffect(() => {
    if (activeJobs.length === 0) return undefined
    const timer = window.setInterval(load, 2000)
    return () => window.clearInterval(timer)
  }, [activeJobs.length, load])

  return (
    <>
      <PageHeader title="Jobs" description="File moves and rebalances between your drives." actions={<Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm t-bad">{error}</p> : null}
      <div className="mt-6 grid gap-4">
        {jobs === null ? [0, 1].map((i) => <Card key={i} className="h-24 animate-pulse" />) : jobs.length === 0 ? (
          <Card className="p-8 text-center"><h2 className="text-lg font-extrabold">No jobs yet</h2><p className="mt-2 text-sm text-slate-500">Use "Move to drive" on files or "Free up space" on the Overview page to start one.</p></Card>
        ) : jobs.map((job) => <JobCard key={job.id} job={job} onChanged={load} />)}
      </div>
    </>
  )
}
