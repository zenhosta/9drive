import { useEffect, useState } from 'react'
import {
  History,
  Clock,
  Plus,
  Trash2,
  RefreshCw,
  Folder,
  FileText,
  Download,
  AlertTriangle,
  Move
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'

type AuditLog = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  metadata: string | any | null
  createdAt: string
}

export function ActivityLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadLogs() {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ logs: AuditLog[] }>('/audit-logs')
      setLogs(data.logs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs().catch(() => undefined)
  }, [])

  function getActionBadge(action: string) {
    const act = action.toUpperCase()
    if (act.includes('CREATE') || act.includes('UPLOAD')) {
      return {
        bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        icon: Plus,
        label: action.replace(/_/g, ' ')
      }
    }
    if (act.includes('DELETE') || act.includes('PERMANENT') || act.includes('TRASH')) {
      return {
        bg: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
        icon: Trash2,
        label: action.replace(/_/g, ' ')
      }
    }
    if (act.includes('RESTORE') || act.includes('SYNC')) {
      return {
        bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        icon: RefreshCw,
        label: action.replace(/_/g, ' ')
      }
    }
    if (act.includes('MOVE')) {
      return {
        bg: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
        icon: Move,
        label: action.replace(/_/g, ' ')
      }
    }
    if (act.includes('DOWNLOAD')) {
      return {
        bg: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
        icon: Download,
        label: action.replace(/_/g, ' ')
      }
    }
    return {
      bg: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
      icon: History,
      label: action.replace(/_/g, ' ')
    }
  }

  function renderMetadata(metadata: any) {
    if (!metadata) return null
    let parsed = metadata
    if (typeof metadata === 'string') {
      try {
        parsed = JSON.parse(metadata)
      } catch {
        return <span className="text-slate-500">{metadata}</span>
      }
    }

    if (typeof parsed !== 'object') {
      return <span className="text-slate-500">{String(parsed)}</span>
    }

    // Special metadata keys rendering
    const parts: string[] = []
    if (parsed.name) parts.push(`Name: ${parsed.name}`)
    if (parsed.fileName) parts.push(`File: ${parsed.fileName}`)
    if (parsed.folderName) parts.push(`Folder: ${parsed.folderName}`)
    if (parsed.count !== undefined) parts.push(`Count: ${parsed.count}`)
    if (parsed.sizeBytes !== undefined) {
      const bytes = Number(parsed.sizeBytes)
      parts.push(`Size: ${formatBytes(bytes)}`)
    }

    if (parts.length > 0) {
      return <span className="text-xs text-slate-500 font-medium">{parts.join(' | ')}</span>
    }

    return <span className="text-xs text-slate-500 font-mono">{JSON.stringify(parsed)}</span>
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="View audit trails and file activities in your 9Drive workspace."
      />

      {error && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}

      <Card className="mt-8 overflow-hidden border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="h-5 w-5 text-slate-500" />
            Recent Activity Trail
          </h2>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-600 mb-2" />
              <p className="text-sm">Loading activity logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <History className="h-12 w-12 stroke-[1.5] mb-3 text-slate-300" />
              <p className="font-semibold text-slate-600">No activity yet</p>
              <p className="text-sm text-slate-400 mt-1">Actions you perform on your folders and files will appear here.</p>
            </div>
          ) : (
            logs.map((log) => {
              const badge = getActionBadge(log.action)
              const EntityIcon = log.entityType === 'folder' ? Folder : FileText

              return (
                <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl border font-bold shrink-0", badge.bg)}>
                      <badge.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 uppercase tracking-wider text-[11px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50">
                          {badge.label}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <EntityIcon className="h-3.5 w-3.5" />
                          <span>{log.entityType}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-col gap-0.5">
                        {renderMetadata(log.metadata)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 self-end sm:self-center">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{formatDate(log.createdAt)}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </Card>
    </>
  )
}
