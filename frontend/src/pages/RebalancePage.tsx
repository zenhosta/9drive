import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { useJobs } from '@/context/JobsContext'
import { apiFetch, formatBytes } from '@/lib/api'
import { isActiveJob, jobPercent, jobStatusLabel, type MoveJob } from '@/lib/jobs'
import { usageBarClass, usageLevel, usagePercent } from '@/lib/storage-thresholds'
import { cn } from '@/lib/utils'

type Account = { id: string; provider: string; email: string; displayName: string | null; totalBytes: string | null; usedBytes: string; availableBytes: string | null; unlimited: boolean }
type PlanAccount = { id: string; email: string; role: 'source' | 'target'; totalBytes: string | null; usedBefore: string; usedAfter: string; availableBefore: string | null; availableAfter: string | null; filesIn: number; filesOut: number }
type Plan = {
  sourceAccountId: string
  needBytes: string
  plannedBytes: string
  shortfallBytes: string
  nativeExcluded: number
  warnings: string[]
  items: Array<{ fileId: string; name: string; sizeBytes: string; targetAccountId: string; targetEmail?: string }>
  unplaced: Array<{ fileId: string; name: string; sizeBytes: string }>
  accounts: PlanAccount[]
}
type Mode = 'amount' | 'percent'

const GB = 1024 ** 3
const steps = ['Source', 'Options', 'Review plan', 'Progress']

function BeforeAfter({ account }: { account: PlanAccount }) {
  const before = usagePercent(account.usedBefore, account.totalBytes)
  const after = usagePercent(account.usedAfter, account.totalBytes)
  const unlimited = account.totalBytes === null
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="min-w-0 truncate font-bold">{account.email} <span className="text-xs font-semibold text-slate-500">({account.role})</span></p>
        <p className="text-xs text-slate-500">{account.role === 'source' ? `${account.filesOut} file(s) out` : `${account.filesIn} file(s) in`}</p>
      </div>
      {unlimited ? <p className="mt-2 text-xs text-slate-500">Unlimited · {formatBytes(account.usedBefore)} → {formatBytes(account.usedAfter)}</p> : (
        <div className="mt-2 grid gap-1.5 text-xs">
          {[['Before', before, account.usedBefore], ['After', after, account.usedAfter]].map(([label, pct, used]) => (
            <div key={String(label)} className="flex items-center gap-2">
              <span className="w-12 text-slate-500">{label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', usageBarClass[usageLevel(Number(pct))])} style={{ width: `${pct}%` }} /></div>
              <span className="w-28 text-right text-slate-500">{formatBytes(used as string)} · {Number(pct).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function RebalancePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { refresh } = useJobs()
  const [step, setStep] = useState(0)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceId, setSourceId] = useState(params.get('source') ?? '')
  const [mode, setMode] = useState<Mode>('amount')
  const [amountGb, setAmountGb] = useState('10')
  const [percent, setPercent] = useState('70')
  const [autoTargets, setAutoTargets] = useState(true)
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState<MoveJob | null>(null)

  useEffect(() => {
    apiFetch<{ accounts: Account[] }>('/storage/overview')
      .then((data) => {
        const google = data.accounts.filter((a) => a.provider === 'google_drive')
        setAccounts(google)
        if (sourceId && google.some((a) => a.id === sourceId)) setStep(1)
        else setSourceId('')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load drives'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const source = accounts.find((a) => a.id === sourceId)
  const others = useMemo(() => accounts.filter((a) => a.id !== sourceId), [accounts, sourceId])

  async function buildPlan() {
    if (!source) return
    setBusy(true)
    setError('')
    try {
      const body: Record<string, unknown> = { sourceAccountId: source.id }
      if (mode === 'amount') body.freeUpBytes = String(Math.round(Number(amountGb) * GB))
      else body.targetUsedPercent = Number(percent)
      if (!autoTargets) body.targetAccountIds = targetIds
      setPlan(await apiFetch<Plan>('/storage/rebalance/plan', { method: 'POST', body: JSON.stringify(body) }))
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build a plan')
    } finally {
      setBusy(false)
    }
  }

  async function execute() {
    if (!plan) return
    setBusy(true)
    setError('')
    try {
      const result = await apiFetch<{ jobId: string }>('/storage/rebalance/execute', { method: 'POST', body: JSON.stringify({ sourceAccountId: plan.sourceAccountId, items: plan.items.map((i) => ({ fileId: i.fileId, targetAccountId: i.targetAccountId })) }) })
      await refresh()
      setJob((await apiFetch<{ job: MoveJob }>(`/jobs/${result.jobId}`)).job)
      setStep(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the rebalance')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (step !== 3 || !job || !isActiveJob(job)) return undefined
    const timer = window.setInterval(async () => {
      try {
        setJob((await apiFetch<{ job: MoveJob }>(`/jobs/${job.id}`)).job)
      } catch { /* retry next tick */ }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [step, job])

  async function cancelJob() {
    if (!job) return
    try {
      await apiFetch(`/jobs/${job.id}/cancel`, { method: 'POST' })
      setJob((await apiFetch<{ job: MoveJob }>(`/jobs/${job.id}`)).job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    }
  }

  const validAmount = mode === 'amount' ? Number(amountGb) > 0 : Number(percent) >= 1 && Number(percent) <= 99
  const canPlan = Boolean(source) && validAmount && (autoTargets || targetIds.length > 0)

  return (
    <>
      <PageHeader title="Free up space" description="Move files from a full drive to emptier ones. You review the plan before anything moves." />

      <ol className="mt-6 flex flex-wrap gap-2" aria-label="Steps">
        {steps.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className={cn('flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold', i === step ? 'bg-blue-600 text-white' : i < step ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}{label}
          </li>
        ))}
      </ol>

      {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {step === 0 ? (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {loading ? [0, 1].map((i) => <Card key={i} className="h-24 animate-pulse" />) : accounts.length < 2 ? (
            <Card className="col-span-full p-6 text-sm text-slate-600">You need at least two connected Google Drive accounts to move files between them.</Card>
          ) : accounts.map((a) => {
            const pct = usagePercent(a.usedBytes, a.totalBytes)
            return (
              <button key={a.id} className={cn('rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-blue-400', sourceId === a.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200')} onClick={() => { setSourceId(a.id); setStep(1) }}>
                <p className="truncate font-extrabold">{a.email}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', usageBarClass[usageLevel(pct)])} style={{ width: `${pct}%` }} /></div>
                <p className="mt-1.5 text-xs text-slate-500">{formatBytes(a.usedBytes)} of {a.unlimited ? 'unlimited' : formatBytes(a.totalBytes)} · {pct.toFixed(0)}% used</p>
              </button>
            )
          })}
        </div>
      ) : null}

      {step === 1 && source ? (
        <Card className="mt-6 grid gap-6 p-5">
          <div>
            <p className="text-sm text-slate-500">Moving files out of</p>
            <p className="font-extrabold">{source.email} <button className="ml-2 text-xs font-semibold text-blue-600 underline" onClick={() => setStep(0)}>change</button></p>
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">How much should be freed?</legend>
            <label className="flex flex-wrap items-center gap-3 text-sm"><input type="radio" name="mode" checked={mode === 'amount'} onChange={() => setMode('amount')} />Free up<input className="h-10 w-28 rounded-xl border border-slate-200 px-3" inputMode="decimal" aria-label="Gigabytes to free" value={amountGb} onChange={(e) => setAmountGb(e.target.value)} disabled={mode !== 'amount'} />GB</label>
            <label className="flex flex-wrap items-center gap-3 text-sm"><input type="radio" name="mode" checked={mode === 'percent'} onChange={() => setMode('percent')} disabled={source.unlimited} />Reduce usage to<input className="h-10 w-24 rounded-xl border border-slate-200 px-3" inputMode="numeric" aria-label="Target percent used" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={mode !== 'percent'} />% of capacity</label>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Where should files go?</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoTargets} onChange={(e) => setAutoTargets(e.target.checked)} />Automatic: use whichever other drives have the most room</label>
            {!autoTargets ? others.map((a) => (
              <label key={a.id} className="ml-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={targetIds.includes(a.id)} onChange={(e) => setTargetIds(e.target.checked ? [...targetIds, a.id] : targetIds.filter((id) => id !== a.id))} />{a.email}<span className="text-xs text-slate-500">({a.unlimited ? 'unlimited' : `${formatBytes(a.availableBytes)} free`})</span></label>
            )) : null}
          </fieldset>
          <p className="text-xs text-slate-500">Targets are never filled beyond 90% and always keep a 100 MB safety margin. Google Docs/Sheets/Slides are left out because they use almost no quota.</p>
          <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setStep(0)}>Back</Button><Button onClick={buildPlan} disabled={!canPlan || busy}>{busy ? 'Building plan...' : 'Build plan'}<ArrowRight className="h-4 w-4" /></Button></div>
        </Card>
      ) : null}

      {step === 2 && plan ? (
        <div className="mt-6 grid gap-5">
          <Card className="p-5">
            <h2 className="text-lg font-extrabold">Dry run: nothing has moved yet</h2>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><dt className="text-xs text-slate-500">Requested</dt><dd className="font-extrabold">{formatBytes(plan.needBytes)}</dd></div>
              <div><dt className="text-xs text-slate-500">Will move</dt><dd className="font-extrabold">{plan.items.length} files · {formatBytes(plan.plannedBytes)}</dd></div>
              <div><dt className="text-xs text-slate-500">Shortfall</dt><dd className={cn('font-extrabold', plan.shortfallBytes !== '0' && 'text-amber-600')}>{formatBytes(plan.shortfallBytes)}</dd></div>
              <div><dt className="text-xs text-slate-500">Skipped (no room)</dt><dd className="font-extrabold">{plan.unplaced.length}</dd></div>
            </dl>
            <ul className="mt-4 grid gap-2">{plan.warnings.map((w) => <li key={w} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{w}</li>)}</ul>
          </Card>
          <div className="grid gap-3 md:grid-cols-2">{plan.accounts.map((a) => <BeforeAfter key={a.id} account={a} />)}</div>
          <Card className="overflow-x-auto p-5">
            <h3 className="font-extrabold">Files to move</h3>
            <table className="mt-3 w-full min-w-[30rem] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3 font-semibold">File</th><th className="py-2 pr-3 font-semibold">Size</th><th className="py-2 font-semibold">Moves to</th></tr></thead>
              <tbody>{plan.items.slice(0, 100).map((i) => <tr key={i.fileId} className="border-t border-slate-100"><td className="max-w-[18rem] truncate py-2 pr-3 font-semibold" title={i.name}>{i.name}</td><td className="py-2 pr-3 text-slate-500">{formatBytes(i.sizeBytes)}</td><td className="py-2 text-slate-500">{i.targetEmail}</td></tr>)}</tbody>
            </table>
            {plan.items.length > 100 ? <p className="mt-2 text-xs text-slate-500">…and {plan.items.length - 100} more.</p> : null}
          </Card>
          <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setStep(1)} disabled={busy}>Back</Button><Button onClick={execute} disabled={busy || plan.items.length === 0}>{busy ? 'Starting...' : `Confirm and move ${plan.items.length} files`}</Button></div>
        </div>
      ) : null}

      {step === 3 && job ? (
        <Card className="mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-extrabold">{jobStatusLabel[job.status]}</h2>{isActiveJob(job) ? <Button variant="outline" size="sm" onClick={cancelJob}>Cancel</Button> : null}</div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={jobPercent(job)}><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${jobPercent(job)}%` }} /></div>
          <p className="mt-2 text-sm text-slate-500">{job.doneItems} moved · {job.failedItems} failed · {job.totalItems} total · {formatBytes(job.movedBytes)} of {formatBytes(job.totalBytes)}</p>
          {!isActiveJob(job) ? <div className="mt-5 flex gap-3"><Button onClick={() => navigate('/overview')}>Back to Overview</Button><Button variant="outline" onClick={() => navigate('/move-jobs')}>Job details</Button></div> : <p className="mt-4 text-xs text-slate-500">You can leave this page. The move keeps running in the background.</p>}
        </Card>
      ) : null}
    </>
  )
}
