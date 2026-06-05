import { Folder, MoreVertical } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { FolderItem } from '@/data/drive-data'

export function FolderGrid({ items, mobileTwoColumns = false, onFolderMenu, onFolderOpen }: { items: FolderItem[]; mobileTwoColumns?: boolean; onFolderMenu?: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void; onFolderOpen?: (folder: FolderItem) => void }) {
  return (
    <div className={cn('mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4', mobileTwoColumns && 'grid-cols-2')}>
      {items.map((folder) => (
        <Card key={folder.name} onClick={() => onFolderOpen?.(folder)} onContextMenu={(event) => onFolderMenu?.(event, folder)} className="group relative flex min-h-36 cursor-pointer flex-col items-center justify-center p-4 transition hover:-translate-y-1 hover:shadow-xl sm:min-h-48 sm:p-6">
          <button className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 sm:right-4 sm:top-4 sm:h-8 sm:w-8 sm:rounded-lg" onClick={(event) => { event.stopPropagation(); onFolderMenu?.(event, folder) }} aria-label={`Open ${folder.name} menu`}><MoreVertical className="h-5 w-5" /></button>
          <Folder className={cn('h-14 w-14 fill-current stroke-current transition group-hover:scale-110 sm:h-20 sm:w-20', folder.color)} />
          <h2 className="mt-3 line-clamp-2 text-center text-sm font-extrabold sm:mt-5 sm:text-lg">{folder.name}</h2>
          <p className="mt-1 line-clamp-1 text-center text-xs text-slate-500 sm:text-sm">{folder.updated}</p>
        </Card>
      ))}
    </div>
  )
}
