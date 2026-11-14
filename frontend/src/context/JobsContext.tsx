import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import { isActiveJob, type MoveJob } from '@/lib/jobs'

type JobsContextType = {
  activeJobs: MoveJob[]
  /** Increments every time a job leaves the active state. Pages watch it to reload their data. */
  finishedVersion: number
  refresh: () => Promise<void>
}

const JobsContext = createContext<JobsContextType | undefined>(undefined)

const BUSY_MS = 2000
const IDLE_MS = 20000

export function JobsProvider({ children }: { children: ReactNode }) {
  const [activeJobs, setActiveJobs] = useState<MoveJob[]>([])
  const [finishedVersion, setFinishedVersion] = useState(0)
  const previousIds = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ jobs: MoveJob[] }>('/jobs?active=1&limit=20')
      const jobs = data.jobs.filter(isActiveJob)
      const nextIds = new Set(jobs.map((j) => j.id))
      if ([...previousIds.current].some((id) => !nextIds.has(id))) setFinishedVersion((v) => v + 1)
      previousIds.current = nextIds
      setActiveJobs(jobs)
    } catch {
      // Transient errors are fine; the next tick retries. Auth failures are handled by apiFetch.
    }
  }, [])

  useEffect(() => {
    let timer: number | undefined
    let stopped = false
    const tick = async () => {
      await refresh()
      if (!stopped) timer = window.setTimeout(tick, previousIds.current.size > 0 ? BUSY_MS : IDLE_MS)
    }
    tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [refresh])

  const value = useMemo(() => ({ activeJobs, finishedVersion, refresh }), [activeJobs, finishedVersion, refresh])
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs() {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used inside JobsProvider')
  return ctx
}
