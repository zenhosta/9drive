import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DummyModal } from '@/components/drive/DummyModal'
import { formatBytes } from '@/lib/api'

/** Confirms a delete and lets the user choose between the Drive trash (recoverable) and permanent deletion. */
export function DeleteFilesDialog({ open, fileCount, folderCount, bytes, busy, onClose, onConfirm }: { open: boolean; fileCount: number; folderCount: number; bytes: number; busy: boolean; onClose: () => void; onConfirm: (permanent: boolean) => void }) {
  const [permanent, setPermanent] = useState(false)
  const [understood, setUnderstood] = useState(false)
  useEffect(() => { if (open) { setPermanent(false); setUnderstood(false) } }, [open])
  const label = `${fileCount.toLocaleString()} file${fileCount === 1 ? '' : 's'}${folderCount ? ` (including everything inside ${folderCount} folder${folderCount === 1 ? '' : 's'})` : ''}`

  return (
    <DummyModal open={open} title="Delete files" description={`${label} · ${formatBytes(bytes)}`} onClose={() => (busy ? undefined : onClose())}>
      <div className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">What should happen?</legend>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="radio" className="mt-1" name="delete-mode" checked={!permanent} onChange={() => setPermanent(false)} /><span><b>Move to the Drive trash</b> (recommended)<br /><span className="text-xs text-slate-500">You can restore them from the trash in Google Drive for 30 days. They keep using storage until the trash is emptied.</span></span></label>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="radio" className="mt-1" name="delete-mode" checked={permanent} onChange={() => setPermanent(true)} /><span><b>Delete permanently</b><br /><span className="text-xs text-slate-500">Frees the space immediately. This cannot be undone.</span></span></label>
        </fieldset>
        {permanent ? <label className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm t-bad"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I understand these files will be gone for good.</label> : null}
        <p className="text-xs text-slate-500">Deleting a folder deletes the files inside it. The empty folder itself is left in place. Files tracked by 9Drive also disappear from its Recycle Bin and share links stop working.</p>
        <div className="grid gap-3 sm:flex sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(permanent)} disabled={busy || (permanent && !understood)}><Trash2 className="h-4 w-4" />{busy ? 'Starting...' : permanent ? 'Delete permanently' : 'Move to trash'}</Button>
        </div>
      </div>
    </DummyModal>
  )
}
