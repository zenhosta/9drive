import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useTranslation } from '@/lib/i18nContext'

export function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  const { t } = useTranslation()
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{t(label)}</p>
          <p className="mt-2 text-2xl font-extrabold">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  )
}
