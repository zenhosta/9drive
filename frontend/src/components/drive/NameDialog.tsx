import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DummyModal } from '@/components/drive/DummyModal'

export type DriveChoice = { accountId: string; label: string }

/**
 * Asks for one name (new folder, rename). With `drives`, also asks which drive to use, for the merged "All drives" view
 * where a new folder has to live on one real drive.
 */
export function NameDialog({ open, title, description, label, initial = '', submitLabel, drives, busy, onClose, onSubmit }: {
  open: boolean
  title: string
  description: string
  label: string
  initial?: string
  submitLabel: string
  drives?: DriveChoice[]
  busy: boolean
  onClose: () => void
  onSubmit: (name: string, accountId?: string) => void
}) {
  const [name, setName] = useState(initial)
  const [drive, setDrive] = useState('')
  const inputId = useId()

  useEffect(() => {
    if (!open) return
    setName(initial)
    setDrive(drives?.[0]?.accountId ?? '')
    // Select the name without the extension, like Google Drive, so typing replaces just the name.
    window.setTimeout(() => {
      const el = document.getElementById(inputId) as HTMLInputElement | null
      if (!el) return
      el.focus()
      const dot = initial.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const trimmed = name.trim()
  const problem = trimmed.includes('/') ? 'Names cannot contain "/".' : trimmed.length > 255 ? 'That name is too long (255 characters max).' : ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || problem || busy) return
    onSubmit(trimmed, drives ? drive : undefined)
  }

  return (
    <DummyModal open={open} title={title} description={description} onClose={() => (busy ? undefined : onClose())}>
      <form className="grid gap-4" onSubmit={submit}>
        <label className="grid gap-1.5 text-sm font-semibold">{label}
          <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} maxLength={300} aria-invalid={Boolean(problem)} />
        </label>
        {problem ? <p role="alert" className="text-sm t-bad">{problem}</p> : null}
        {drives ? (
          <label className="grid gap-1.5 text-sm font-semibold">Drive
            <select className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm" value={drive} onChange={(e) => setDrive(e.target.value)}>
              {drives.map((d) => <option key={d.accountId} value={d.accountId}>{d.label}</option>)}
            </select>
          </label>
        ) : null}
        <div className="grid gap-3 sm:flex sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !trimmed || Boolean(problem) || (drives ? !drive : false)}>{busy ? 'Saving...' : submitLabel}</Button>
        </div>
      </form>
    </DummyModal>
  )
}
