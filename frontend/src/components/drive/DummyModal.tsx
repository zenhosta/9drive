import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function DummyModal({ open, title, description, children, onClose, className }: { open: boolean; title: string; description: string; children: ReactNode; onClose: () => void; className?: string }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cn('relative outline-none max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-3xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 p-5 shadow-2xl shadow-slate-950/20 sm:max-w-md sm:rounded-2xl', className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-extrabold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Close modal" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}
