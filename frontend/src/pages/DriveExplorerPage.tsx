import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Cloud } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { DriveFilesBrowser } from '@/pages/DriveFilesBrowser'
import { apiFetch, formatBytes } from '@/lib/api'
import { usageBarClass, usageLevel, usagePercent } from '@/lib/storage-thresholds'
import { cn } from '@/lib/utils'

type OverviewAccount = { id: string; email: string; displayName: string | null; provider: string; totalBytes: string | null; usedBytes: string; availableBytes: string | null; unlimited: boolean }

/** One drive, opened like Google Drive: header with its space usage, then the folder explorer. */
export function DriveExplorerPage() {
  const { accountId = '' } = useParams()
  const [account, setAccount] = useState<OverviewAccount | null | undefined>(undefined)

  useEffect(() => {
    apiFetch<{ accounts: OverviewAccount[] }>('/storage/overview')
      .then((d) => setAccount(d.accounts.find((a) => a.id === accountId) ?? null))
      .catch(() => setAccount(null))
  }, [accountId])

  if (account === null) {
    return (
      <Card className="mt-6 p-8 text-center">
        <h1 className="text-lg font-extrabold">Drive not found</h1>
        <p className="mt-2 text-sm text-slate-500">It may have been disconnected.</p>
        <Link to="/all-files" className="mt-4 inline-block font-semibold t-link underline">Back to All Files</Link>
      </Card>
    )
  }

  const percent = account ? usagePercent(account.usedBytes, account.totalBytes) : 0
  return (
    <>
      <Link to="/all-files" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold t-link hover:underline"><ArrowLeft className="h-4 w-4" />All drives</Link>
      <Card className="mt-3 flex flex-wrap items-center gap-4 p-4">
        <div className="on-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600"><Cloud className="h-5 w-5" aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold">{account ? (account.displayName && account.displayName !== account.email ? account.displayName : account.email) : 'Loading…'}</h1>
          <p className="truncate text-sm text-slate-500">{account?.email}</p>
        </div>
        {account ? (
          <div className="w-full min-w-[12rem] sm:w-72">
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{formatBytes(account.usedBytes)} used</span><span>{account.unlimited ? 'Unlimited' : `${formatBytes(account.availableBytes)} free of ${formatBytes(account.totalBytes)}`}</span></div>
            {account.unlimited ? null : <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><div className={cn('h-full rounded-full', usageBarClass[usageLevel(percent)])} style={{ width: `${percent}%` }} /></div>}
          </div>
        ) : null}
      </Card>
      <DriveFilesBrowser driveId={accountId} />
    </>
  )
}
