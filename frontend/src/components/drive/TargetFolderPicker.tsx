import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Folder, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

export type TargetFolder = { id: string; path: string }
type Crumb = { id: string; name: string }
type FolderRow = { id: string; name: string }

const pathOf = (stack: Crumb[]) => stack.map((c) => c.name).join('/')

/**
 * Chooses where files land in the destination drive: the default 9drive folder, or any folder in that drive
 * (browse by clicking, or create a new one at the current level).
 */
export function TargetFolderPicker({ accountId, value, onChange }: { accountId: string; value: TargetFolder | null; onChange: (folder: TargetFolder | null) => void }) {
  const [custom, setCustom] = useState(Boolean(value))
  const [stack, setStack] = useState<Crumb[]>([{ id: 'root', name: 'My Drive' }])
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const current = stack[stack.length - 1]

  const load = useCallback(async (parentId: string) => {
    setLoading(true)
    setError('')
    try {
      setFolders((await apiFetch<{ folders: FolderRow[] }>(`/drive-index/folders?accountId=${encodeURIComponent(accountId)}&parentId=${encodeURIComponent(parentId)}`)).folders)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list folders')
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [accountId])

  // A different destination drive has different folders: start over.
  useEffect(() => {
    setCustom(false)
    setStack([{ id: 'root', name: 'My Drive' }])
    setNewName('')
    onChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  useEffect(() => {
    if (custom) load(current.id)
  }, [custom, current.id, load])

  // While "choose a folder" is on, the folder you are looking at is always the destination.
  function navigate(next: Crumb[]) {
    setStack(next)
    onChange({ id: next[next.length - 1].id, path: pathOf(next) })
  }

  const enter = (folder: FolderRow) => navigate([...stack, { id: folder.id, name: folder.name }])
  const goTo = (index: number) => navigate(stack.slice(0, index + 1))

  async function create() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError('')
    try {
      const r = await apiFetch<{ folder: { id: string; name: string; path: string } }>('/drive-index/folders', { method: 'POST', body: JSON.stringify({ accountId, parentId: current.id, name }) })
      setNewName('')
      setStack((prev) => [...prev, { id: r.folder.id, name: r.folder.name }])
      onChange({ id: r.folder.id, path: r.folder.path })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the folder')
    } finally {
      setCreating(false)
    }
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">Destination folder</legend>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="folder-mode" checked={!custom} onChange={() => { setCustom(false); onChange(null) }} />The <b>9drive</b> folder (default)</label>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="folder-mode" checked={custom} onChange={() => { setCustom(true); onChange({ id: current.id, path: pathOf(stack) }) }} />Choose or create a folder</label>

      {custom ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
            {stack.map((c, i) => (
              <span key={`${c.id}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden /> : null}
                <button type="button" className={cn('rounded px-1 font-semibold hover:bg-slate-100', i === stack.length - 1 && 'text-blue-600')} onClick={() => goTo(i)}>{c.name}</button>
              </span>
            ))}
          </nav>

          <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-1" aria-busy={loading}>
            {loading ? <li className="px-2 py-1.5 text-sm text-slate-500">Loading folders...</li> : folders.length === 0 ? <li className="px-2 py-1.5 text-sm text-slate-500">No folders here yet.</li> : folders.map((f) => (
              <li key={f.id}><button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white" onClick={() => enter(f)}><Folder className="h-4 w-4 shrink-0 text-amber-500" aria-hidden /><span className="truncate">{f.name}</span></button></li>
            ))}
          </ul>

          <div className="mt-2 flex gap-2">
            <input className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm" placeholder={`New folder in ${current.name}`} aria-label="New folder name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
            <Button type="button" size="sm" variant="outline" onClick={create} disabled={creating || !newName.trim()}><FolderPlus className="h-4 w-4" />{creating ? 'Creating...' : 'Create'}</Button>
          </div>

          {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}

          <p className="mt-3 truncate text-xs text-slate-500">Files will be moved into <b>{pathOf(stack)}</b></p>
        </div>
      ) : null}
    </fieldset>
  )
}
