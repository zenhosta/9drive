import { useSearchParams } from 'react-router-dom'
import { AllFilesPage } from '@/pages/AllFilesPage'
import { DriveFilesBrowser } from '@/pages/DriveFilesBrowser'
import { PageHeader } from '@/components/drive/PageHeader'
import { cn } from '@/lib/utils'

/**
 * All Files has two views: the real contents of your drives (default) and the original 9Drive view of uploads and
 * virtual folders. Deep links that carry a virtual folder id keep opening the original view.
 */
export function AllFilesRoute() {
  const [params, setParams] = useSearchParams()
  const uploads = params.get('view') === 'uploads' || params.has('folderId')

  function switchTo(view: 'drives' | 'uploads') {
    setParams(view === 'uploads' ? { view: 'uploads' } : {}, { replace: false })
  }

  return (
    <>
      {uploads ? null : <PageHeader title="All Files" description="Everything in your connected drives, folder by folder." />}
      <div role="tablist" aria-label="All files view" className={cn('flex gap-2', uploads ? 'mt-2' : 'mt-5')}>
        <button role="tab" aria-selected={!uploads} onClick={() => switchTo('drives')} className={cn('rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', !uploads ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>Drive files</button>
        <button role="tab" aria-selected={uploads} onClick={() => switchTo('uploads')} className={cn('rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', uploads ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>Uploads & folders</button>
      </div>
      {uploads ? <AllFilesPage /> : <DriveFilesBrowser />}
    </>
  )
}
