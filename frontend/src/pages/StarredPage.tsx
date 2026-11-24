import { FileText, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { FileTable } from '@/components/drive/FileTable'
import { MetricCard } from '@/components/drive/MetricCard'
import { PageHeader } from '@/components/drive/PageHeader'
import { files } from '@/data/drive-data'
import { useTranslation } from '@/lib/i18nContext'

const starred = files.filter((file) => file.starredDate)

export function StarredPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('Starred')} description={t('Pinned files for quick access.')} />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <MetricCard label={t('Starred Files')} value="3" icon={Star} />
        <MetricCard label={t('Quick Opens')} value="18" icon={FileText} />
        <MetricCard label={t('Folders')} value="1" icon={Star} />
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {starred.map((file) => (
          <Card key={file.name} className="p-5">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            <h2 className="mt-4 font-extrabold">{file.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('Starred on')} {file.starredDate}</p>
          </Card>
        ))}
      </div>
      <FileTable files={starred} mode="starred" />
    </>
  )
}
