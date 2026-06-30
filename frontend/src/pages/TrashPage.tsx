import { useEffect, useState } from 'react'
import { RotateCcw, Trash2, ShieldAlert, FileText, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatBytes } from '@/lib/api'

type TrashFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  provider: string
  deletedAt: string
  connectedAccount: {
    email: string
    provider: string
  }
}

export function TrashPage() {
  const [files, setFiles] = useState<TrashFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | ''>('')

  async function loadTrash() {
    setLoading(true)
    try {
      const data = await apiFetch<{ files: TrashFile[] }>('/files/trash')
      setFiles(data.files)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load trash')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTrash().catch(() => undefined)
  }, [])

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  function toggleSelectAll() {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)))
    }
  }

  async function handleRestore(ids: string[]) {
    if (ids.length === 0) return
    setLoading(true)
    setMessage('')
    try {
      await apiFetch('/files/batch/restore', {
        method: 'POST',
        body: JSON.stringify({ fileIds: ids })
      })
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setMessage(`Successfully restored ${ids.length} file(s).`)
      setMessageType('success')
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to restore files')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function handlePermanentDelete(ids: string[]) {
    if (ids.length === 0) return
    if (!confirm(`Are you sure you want to permanently delete ${ids.length} file(s)? This action cannot be undone.`)) return
    setLoading(true)
    setMessage('')
    try {
      await apiFetch('/files/batch/permanent', {
        method: 'DELETE',
        body: JSON.stringify({ fileIds: ids })
      })
      setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setMessage(`Permanently deleted ${ids.length} file(s).`)
      setMessageType('success')
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to permanently delete files')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Recycle Bin"
        description="Manage deleted files. Restore them to active folders or delete them permanently."
        actions={
          selectedIds.size > 0 ? (
            <>
              <Button variant="outline" onClick={() => handleRestore(Array.from(selectedIds))} disabled={loading}>
                <RotateCcw className="h-4 w-4" /> Restore Selected ({selectedIds.size})
              </Button>
              <Button variant="danger" onClick={() => handlePermanentDelete(Array.from(selectedIds))} disabled={loading}>
                <Trash2 className="h-4 w-4" /> Delete Selected ({selectedIds.size})
              </Button>
            </>
          ) : null
        }
      />

      {message ? (
        <p
          className={`mt-5 rounded-xl p-3 text-sm flex items-center gap-2 ${
            messageType === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {messageType === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {message}
        </p>
      ) : null}

      <Card className="mt-8 overflow-hidden">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Trash2 className="h-12 w-12 text-slate-400 mb-3" />
            <p className="text-base font-bold">Trash is empty</p>
            <p className="text-sm text-slate-500 mt-1">Deleted files will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-sm font-semibold text-slate-500">
                  <th className="p-4 w-12">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === files.length && files.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="p-4">Name</th>
                  <th className="p-4">Account</th>
                  <th className="p-4">Size</th>
                  <th className="p-4">Deleted At</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(file.id)}
                        onChange={() => toggleSelect(file.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-slate-400 shrink-0" />
                        <span className="font-medium truncate max-w-xs sm:max-w-md block" title={file.name}>
                          {file.name}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-500">
                      {file.connectedAccount.email} ({file.provider})
                    </td>
                    <td className="p-4 text-sm font-semibold">{formatBytes(file.sizeBytes)}</td>
                    <td className="p-4 text-sm text-slate-500">
                      {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(file.deletedAt))}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRestore([file.id])}
                          disabled={loading}
                          title="Restore"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handlePermanentDelete([file.id])}
                          disabled={loading}
                          title="Delete Permanently"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
