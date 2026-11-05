import { useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Cloud, Database, Files, FolderOpen, HardDrive, Link2, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useJobs } from '@/context/JobsContext'
import { useToast } from '@/context/ToastContext'
import { DummyModal } from '@/components/drive/DummyModal'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { usageBarClass, usageLevel, usagePercent, usageTextClass } from '@/lib/storage-thresholds'
import { cn } from '@/lib/utils'

type Health = 'ok' | 'needs_reconnect' | 'error'
type OverviewAccount = {
  id: string
  provider: string
  email: string
  displayName: string | null
  totalBytes: string | null
  usedBytes: string
  availableBytes: string | null
  unlimited: boolean
  lastSyncedAt: string | null
  fileCount: number
  fileBytes: string
  health: Health
  lastError: string | null
}
type OverviewTotals = { accountCount: number; unlimitedAccounts: number; totalBytes: string; usedBytes: string; availableBytes: string; fileCount: number; fileBytes: string }
type Overview = { totals: OverviewTotals; accounts: OverviewAccount[] }
type RefreshResponse = { results: Array<{ accountId: string; ok: boolean; message?: string }>; overview: Overview }

type SortKey = 'most_full' | 'most_free' | 'name'
type ProviderFilter = 'all' | 'google_drive' | 's3'

const levelLabel = { normal: 'Healthy', warning: 'Getting full', critical: 'Almost full' } as const

function providerLabel(provider: string) {
  return provider === 's3' ? 'S3 storage' : 'Google Drive'
}

function accountName(account: OverviewAccount) {
  return account.displayName && account.displayName !== account.email ? account.displayName : account.email
}

function UsageBar({ percent, label }: { percent: number; label: string }) {
  const level = usageLevel(percent)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-2.5 overflow-hidden rounded-full bg-slate-100"
    >
      <div className={cn('h-full rounded-full transition-all', usageBarClass[level])} style={{ width: `${percent}%` }} />
    </div>
  )
}

export function OverviewPage() {
  const navigate = useNavigate()
  const { finishedVersion } = useJobs()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const toast = useToast()
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('most_full')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
  const [toDisconnect, setToDisconnect] = useState<OverviewAccount | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<Overview>('/storage/overview'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, finishedVersion])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'GOOGLE_CONNECTED') return
      if (event.data.status === 'success') toast.success('Google Drive connected.')
      else toast.error('Google Drive connection failed.')
      load()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [load, toast])

  async function refreshAll() {
    setRefreshingAll(true)
    try {
      const result = await apiFetch<RefreshResponse>('/storage/overview/refresh', { method: 'POST' })
      setData(result.overview)
      const failed = result.results.filter((r) => !r.ok)
      if (failed.length === 0) toast.success(`Synced ${result.results.length} account${result.results.length === 1 ? '' : 's'}.`)
      else toast.error(`${failed.length} of ${result.results.length} accounts failed to sync. See the warnings on the cards.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshingAll(false)
    }
  }

  async function syncOne(account: OverviewAccount) {
    setSyncingId(account.id)
    try {
      await apiFetch(`/connected-accounts/${account.id}/sync-quota`, { method: 'POST' })
    } catch (e) {
      toast.error(`${account.email}: ${e instanceof Error ? e.message : 'Sync failed'}`)
    } finally {
      await load()
      setSyncingId(null)
    }
  }

  async function connectGoogle() {
    const popup = window.open('', 'google-drive-connect', 'width=540,height=720')
    try {
      const result = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
      if (popup) popup.location.href = result.url
      else window.location.href = result.url
    } catch (e) {
      popup?.close()
      toast.error(e instanceof Error ? e.message : 'Failed to start Google connection')
    }
  }

  async function confirmDisconnect() {
    if (!toDisconnect) return
    setDisconnecting(true)
    try {
      await apiFetch(`/connected-accounts/${toDisconnect.id}`, { method: 'DELETE' })
      toast.success(`${toDisconnect.email} disconnected.`)
      setToDisconnect(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  const accounts = useMemo(() => {
    const list = (data?.accounts ?? []).filter((a) => providerFilter === 'all' || a.provider === providerFilter)
    const pct = (a: OverviewAccount) => usagePercent(a.usedBytes, a.totalBytes)
    // Unlimited accounts have no meaningful percentage or free space, so they sort last for fullness/free.
    const free = (a: OverviewAccount) => (a.unlimited || a.availableBytes === null ? -1 : Number(a.availableBytes))
    return [...list].sort((a, b) => {
      if (sort === 'name') return accountName(a).localeCompare(accountName(b))
      if (sort === 'most_free') return free(b) - free(a)
      return pct(b) - pct(a)
    })
  }, [data, sort, providerFilter])

  const totals = data?.totals
  const totalPercent = totals ? usagePercent(totals.usedBytes, totals.totalBytes) : 0
  const hasProblems = (data?.accounts ?? []).some((a) => a.health !== 'ok')

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every connected drive at a glance."
        actions={
          <>
            <Button variant="outline" onClick={connectGoogle}><Link2 className="h-4 w-4" />Connect Drive</Button>
            <Button onClick={refreshAll} disabled={refreshingAll || !data?.accounts.length}>
              <RefreshCw className={cn('h-4 w-4', refreshingAll && 'animate-spin')} />
              {refreshingAll ? 'Refreshing...' : 'Refresh all'}
            </Button>
          </>
        }
      />

      {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm t-bad">{error}</p> : null}

      {loading ? (
        <div className="mt-6 grid gap-4" aria-busy="true">
          <Card className="h-36 animate-pulse" />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <Card key={i} className="h-60 animate-pulse" />)}
          </div>
        </div>
      ) : totals ? (
        <>
          <Card className="mt-6 p-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <div><p className="text-sm text-slate-500">Total capacity</p><p className="mt-1 text-2xl font-extrabold">{formatBytes(totals.totalBytes)}</p>{totals.unlimitedAccounts > 0 ? <p className="text-xs text-slate-500">+ {totals.unlimitedAccounts} unlimited</p> : null}</div>
              <div><p className="text-sm text-slate-500">Used</p><p className="mt-1 text-2xl font-extrabold">{formatBytes(totals.usedBytes)}</p></div>
              <div><p className="text-sm text-slate-500">Free</p><p className="mt-1 text-2xl font-extrabold">{formatBytes(totals.availableBytes)}</p></div>
              <div><p className="text-sm text-slate-500">Drives</p><p className="mt-1 text-2xl font-extrabold">{totals.accountCount}</p></div>
              <div><p className="text-sm text-slate-500">Files in 9Drive</p><p className="mt-1 text-2xl font-extrabold">{totals.fileCount.toLocaleString()}</p><p className="text-xs text-slate-500">{formatBytes(totals.fileBytes)}</p></div>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold">Combined usage{totals.unlimitedAccounts > 0 ? ' (limited drives only)' : ''}</span>
                <span className={cn('font-bold', usageTextClass[usageLevel(totalPercent)])}>{totalPercent.toFixed(1)}%</span>
              </div>
              <UsageBar percent={totalPercent} label="Combined storage usage" />
            </div>
          </Card>

          {hasProblems ? (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />Some drives need attention. Reconnect them or check the error shown on their card.</p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              Sort
              <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="most_full">Most full</option>
                <option value="most_free">Most free</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              Provider
              <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value as ProviderFilter)}>
                <option value="all">All</option>
                <option value="google_drive">Google Drive</option>
                <option value="s3">S3 storage</option>
              </select>
            </label>
          </div>

          {accounts.length === 0 ? (
            <Card className="mt-6 p-8 text-center">
              <HardDrive className="mx-auto h-10 w-10 t-link" />
              <h2 className="mt-4 text-xl font-extrabold">{data?.accounts.length ? 'No drives match this filter' : 'No connected drives'}</h2>
              <p className="mt-2 text-sm text-slate-500">{data?.accounts.length ? 'Try a different provider filter.' : 'Connect a Google Drive account to start.'}</p>
              {!data?.accounts.length ? <Button className="mt-5" onClick={connectGoogle}><Link2 className="h-4 w-4" />Connect Drive</Button> : null}
            </Card>
          ) : (
            <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => {
                const percent = usagePercent(account.usedBytes, account.totalBytes)
                const level = usageLevel(percent)
                const Icon = account.provider === 's3' ? Database : Cloud
                return (
                  <Card key={account.id} className="flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="on-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600"><Icon className="h-5 w-5" /></div>
                        <div className="min-w-0">
                          <h2 className="truncate font-extrabold" title={accountName(account)}>{accountName(account)}</h2>
                          <p className="truncate text-sm text-slate-500" title={account.email}>{account.displayName && account.displayName !== account.email ? `${account.email} · ` : ''}{providerLabel(account.provider)}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="icon" aria-label={`Sync quota for ${account.email}`} title="Sync quota" onClick={() => syncOne(account)} disabled={syncingId === account.id || refreshingAll}>
                        <RefreshCw className={cn('h-4 w-4', syncingId === account.id && 'animate-spin')} />
                      </Button>
                    </div>

                    {account.health !== 'ok' ? (
                      <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-bold">{account.health === 'needs_reconnect' ? 'Needs reconnect' : 'Last sync reported an error'}</p>
                          {account.lastError ? <p className="mt-0.5 line-clamp-2 break-words opacity-80" title={account.lastError}>{account.lastError}</p> : null}
                          {account.health === 'needs_reconnect' && account.provider === 'google_drive' ? <button className="mt-1.5 font-bold underline" onClick={connectGoogle}>Reconnect</button> : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-semibold">{account.unlimited ? 'Unlimited' : levelLabel[level]}</span>
                        {account.unlimited ? null : <span className={cn('font-bold', usageTextClass[level])}>{percent.toFixed(1)}%</span>}
                      </div>
                      {account.unlimited ? null : <UsageBar percent={percent} label={`Storage used on ${account.email}`} />}
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div><dt className="text-xs text-slate-500">Used</dt><dd className="font-bold">{formatBytes(account.usedBytes)}</dd></div>
                        <div><dt className="text-xs text-slate-500">Free</dt><dd className="font-bold">{account.unlimited ? '∞' : formatBytes(account.availableBytes)}</dd></div>
                        <div><dt className="text-xs text-slate-500">Total</dt><dd className="font-bold">{account.unlimited ? '∞' : formatBytes(account.totalBytes)}</dd></div>
                      </dl>
                    </div>

                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                      <Files className="h-4 w-4 shrink-0 text-slate-500" />
                      <span><b>{account.fileCount.toLocaleString()}</b> file{account.fileCount === 1 ? '' : 's'} · {formatBytes(account.fileBytes)} stored by 9Drive</span>
                    </div>

                    <p className="mt-3 text-xs text-slate-500">{account.lastSyncedAt ? `Quota synced ${formatDate(account.lastSyncedAt)}` : 'Quota never synced'}</p>

                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      {account.provider === 'google_drive' ? <Button variant="soft" size="sm" onClick={() => navigate(`/rebalance?source=${account.id}`)}><Wrench className="h-4 w-4" />Free up space</Button> : null}
                      <Button variant="outline" size="sm" onClick={() => navigate(`/drives/${account.id}`)}><FolderOpen className="h-4 w-4" />Browse files</Button>
                      <Button variant="danger" size="sm" onClick={() => setToDisconnect(account)}><Trash2 className="h-4 w-4" />Disconnect</Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      ) : null}

      <DummyModal
        open={Boolean(toDisconnect)}
        title="Disconnect this drive?"
        description="9Drive will stop using this account."
        onClose={() => (disconnecting ? undefined : setToDisconnect(null))}
      >
        <div className="grid gap-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">{toDisconnect?.email}</p>
            <p className="mt-1">{toDisconnect?.fileCount.toLocaleString()} file{toDisconnect?.fileCount === 1 ? '' : 's'} · {formatBytes(toDisconnect?.fileBytes)} stored by 9Drive</p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Nothing is deleted from the Drive itself. Your files stay there.</li>
            <li>Files on this drive disappear from 9Drive and can't be opened, downloaded or shared until you reconnect it.</li>
            <li>New uploads will no longer go to this drive.</li>
            <li>Reconnecting the same Google account later brings the files back.</li>
          </ul>
          <div className="grid gap-3 sm:flex sm:justify-end">
            <Button variant="outline" onClick={() => setToDisconnect(null)} disabled={disconnecting}>Cancel</Button>
            <Button variant="danger" onClick={confirmDisconnect} disabled={disconnecting}><Trash2 className="h-4 w-4" />{disconnecting ? 'Disconnecting...' : 'Disconnect'}</Button>
          </div>
        </div>
      </DummyModal>
    </>
  )
}
