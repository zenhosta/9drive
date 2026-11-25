export type JobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'
export type ItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'

export type MoveJob = {
  id: string
  type: 'move' | 'rebalance' | 'copy' | 'delete'
  status: JobStatus
  options: { includeNative?: boolean; nativeFormat?: string }
  totalItems: number
  doneItems: number
  failedItems: number
  skippedItems: number
  totalBytes: string
  movedBytes: string
  cancelRequested: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type MoveJobItem = {
  id: string
  fileId: string
  fileName: string
  sourceAccountId: string
  targetAccountId: string
  bytes: string
  status: ItemStatus
  step: string
  attempts: number
  error: string | null
  note: string | null
  updatedAt: string
}

export const isActiveJob = (job: Pick<MoveJob, 'status'>) => job.status === 'queued' || job.status === 'running'

export function jobPercent(job: MoveJob) {
  if (job.totalItems <= 0) return 0
  return Math.min(100, Math.round(((job.doneItems + job.failedItems) / job.totalItems) * 100))
}

export const jobStatusLabel: Record<JobStatus, string> = {
  queued: 'Queued',
  running: 'Moving',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export const itemStatusLabel: Record<ItemStatus, string> = {
  queued: 'Waiting',
  running: 'Moving',
  done: 'Moved',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
}
