export type UsageLevel = 'normal' | 'warning' | 'critical'

export const WARNING_PERCENT = 70
export const CRITICAL_PERCENT = 90

export function usagePercent(used: string | number | null | undefined, total: string | number | null | undefined) {
  const t = Number(total ?? 0)
  if (!Number.isFinite(t) || t <= 0) return 0
  return Math.min(100, (Number(used ?? 0) / t) * 100)
}

export function usageLevel(percent: number): UsageLevel {
  if (percent > CRITICAL_PERCENT) return 'critical'
  if (percent >= WARNING_PERCENT) return 'warning'
  return 'normal'
}

export const usageBarClass: Record<UsageLevel, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
}

export const usageTextClass: Record<UsageLevel, string> = {
  normal: 't-ok',
  warning: 't-warn',
  critical: 't-bad',
}
