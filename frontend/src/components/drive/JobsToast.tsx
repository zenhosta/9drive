import { Link } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import { useJobs } from '@/context/JobsContext'
import { formatBytes } from '@/lib/api'
import { jobPercent } from '@/lib/jobs'

/** Small always-visible indicator for moves in progress (the full history lives on the Jobs page). */
export function JobsToast() {
  const { activeJobs } = useJobs()
  if (activeJobs.length === 0) return null
  return (
    <Link
      to="/move-jobs"
      className="fixed bottom-4 left-4 z-40 w-[min(calc(100vw-2rem),20rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-900"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-extrabold"><ArrowRightLeft className="h-4 w-4 animate-pulse t-link" />Working on your files</div>
      <div className="mt-3 grid gap-3">
        {activeJobs.slice(0, 3).map((job) => (
          <div key={job.id}>
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{job.doneItems + job.failedItems} / {job.totalItems} files</span><span>{formatBytes(job.movedBytes)} of {formatBytes(job.totalBytes)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={jobPercent(job)}>
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${jobPercent(job)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {activeJobs.length > 3 ? <p className="mt-2 text-xs text-slate-500">+ {activeJobs.length - 3} more</p> : null}
    </Link>
  )
}
