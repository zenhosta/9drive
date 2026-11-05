import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Kind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: Kind; text: string }
type ToastApi = { success: (text: string) => void; error: (text: string) => void; info: (text: string) => void }

const ToastContext = createContext<ToastApi | undefined>(undefined)

const styles: Record<Kind, { icon: typeof Info; tone: string }> = {
  success: { icon: CheckCircle2, tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  error: { icon: XCircle, tone: 'border-red-200 bg-red-50 text-red-900' },
  info: { icon: Info, tone: 'border-blue-200 bg-blue-50 text-blue-900' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])
  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId.current++
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }])
    window.setTimeout(() => dismiss(id), kind === 'error' ? 10000 : 5000)
  }, [dismiss])

  const api = useMemo<ToastApi>(() => ({ success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t) }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(calc(100vw-2rem),22rem)] flex-col gap-2">
        {toasts.map((t) => {
          const { icon: Icon, tone } = styles[t.kind]
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={cn('pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 text-sm shadow-lg', tone)}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="toast-text min-w-0 flex-1 break-words">{t.text}</p>
              <button type="button" className="rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><X className="h-4 w-4" /></button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
