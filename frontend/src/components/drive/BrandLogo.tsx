import { cn } from '@/lib/utils'

export function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-200', className)}>
      <svg viewBox="0 0 40 40" className="h-7 w-7" role="img" aria-label="Multinary logo">
        <path fill="currentColor" d="M20 5.5c5.8 0 10.5 4.4 10.5 9.8 0 7.7-7.1 13.6-17.7 18.9a1.2 1.2 0 0 1-1.6-1.6l4.5-8.6A9.6 9.6 0 0 1 9.5 15.3C9.5 9.9 14.2 5.5 20 5.5Zm0 5.2c-2.7 0-4.9 2-4.9 4.6s2.2 4.6 4.9 4.6 4.9-2 4.9-4.6-2.2-4.6-4.9-4.6Z" opacity=".95" />
        <path fill="#bfdbfe" d="M24 24.8c-1.6.9-3.5 1.8-5.7 2.9l-1.5 2.9c5.5-2.9 9.7-5.9 12.1-9.4-1.1 1.1-2.7 2.1-4.9 3.6Z" />
      </svg>
    </div>
  )
}
