import { Clock, Download, Edit3, Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { FileTable } from '@/components/drive/FileTable'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { files } from '@/data/drive-data'
import { useTranslation } from '@/lib/i18nContext'

const activities = [
  { text: 'Opened Travel Landing Page', time: '10 minutes ago', icon: Eye },
  { text: 'Edited Campaign Assets', time: '1 hour ago', icon: Edit3 },
  { text: 'Downloaded Wedding Video', time: 'Yesterday', icon: Download },
]

export function RecentPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('Recent')} description={t('Latest opened and modified files.')} />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label={t('Opened Today')} value="8" icon={Eye} />
        <MetricCard label={t('Modified')} value="4" icon={Edit3} />
        <MetricCard label={t('Downloads')} value="2" icon={Download} />
      </div>
      <Card className="mt-8 p-5">
        <h2 className="font-extrabold">{t('Activity')}</h2>
        <div className="mt-4 grid gap-3">
          {activities.map((activity) => (
            <div key={activity.text} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm"><activity.icon className="h-4 w-4" /></div>
              <div className="flex-1"><p className="font-semibold">{t(activity.text)}</p><p className="text-sm text-slate-500">{t(activity.time)}</p></div>
              <Clock className="h-4 w-4 text-slate-400" />
            </div>
          ))}
        </div>
      </Card>
      <FileTable files={files} mode="recent" />
    </>
  )
}
