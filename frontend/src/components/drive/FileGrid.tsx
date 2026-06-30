import { MoreVertical } from 'lucide-react'
import type { MouseEvent } from 'react'
import { Card } from '@/components/ui/card'
import { FileIcon } from '@/components/drive/FileIcon'
import type { FileItem } from '@/data/drive-data'
import { cn } from '@/lib/utils'

export type FileSizeScale = 'xs' | 'sm' | 'md' | 'lg'

const scaleConfig: Record<FileSizeScale, {
  grid: string
  card: string
  checkbox: string
  menuBtn: string
  iconShell: string
  icon: string
  title: string
  date: string
  tagsShell: string
  tag: string
  mtCard: string
}> = {
  xs: {
    grid: 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2',
    card: 'p-2.5',
    checkbox: 'h-4 w-4',
    menuBtn: '-mr-2.5 -mt-2.5 h-7 w-7',
    iconShell: 'h-10 w-10 mt-1',
    icon: 'h-5 w-5 p-1',
    title: 'text-[11px] min-h-7 mt-2',
    date: 'text-[9px] mt-0.5',
    tagsShell: 'mt-1.5 gap-1',
    tag: 'px-1.5 py-0.5 text-[9px]',
    mtCard: 'mt-2',
  },
  sm: {
    grid: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5',
    card: 'p-3',
    checkbox: 'h-4.5 w-4.5',
    menuBtn: '-mr-2 -mt-2 h-8 w-8',
    iconShell: 'h-12 w-12 mt-2',
    icon: 'h-7 w-7 p-1.5',
    title: 'text-xs min-h-8 mt-3',
    date: 'text-[10px] mt-1',
    tagsShell: 'mt-2 gap-1.5',
    tag: 'px-2 py-0.5 text-[10px]',
    mtCard: 'mt-3',
  },
  md: {
    grid: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5',
    card: 'p-4',
    checkbox: 'h-5 w-5',
    menuBtn: '-mr-2 -mt-2 h-10 w-10',
    iconShell: 'h-16 w-16 sm:h-20 sm:w-20 mt-4',
    icon: 'h-9 w-9 rounded-xl p-2 sm:h-11 sm:w-11',
    title: 'line-clamp-2 min-h-10 text-sm font-extrabold text-slate-950 mt-5',
    date: 'mt-2 truncate text-xs text-slate-500',
    tagsShell: 'mt-3 flex flex-wrap justify-center gap-2 text-xs font-semibold text-slate-600',
    tag: 'rounded-full bg-slate-100 px-2.5 py-1',
    mtCard: 'mt-5',
  },
  lg: {
    grid: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6',
    card: 'p-6',
    checkbox: 'h-6 w-6',
    menuBtn: '-mr-3 -mt-3 h-12 w-12',
    iconShell: 'h-24 w-24 sm:h-32 sm:w-32 mt-6',
    icon: 'h-14 w-14 rounded-2xl p-3 sm:h-18 sm:w-18',
    title: 'line-clamp-2 min-h-12 text-base font-extrabold text-slate-950 mt-6 sm:text-lg',
    date: 'mt-2 truncate text-sm text-slate-500',
    tagsShell: 'mt-4 flex flex-wrap justify-center gap-2 text-sm font-semibold text-slate-600',
    tag: 'rounded-full bg-slate-100 px-3 py-1.5',
    mtCard: 'mt-6',
  },
}

export function FileGrid({
  files,
  selectedFileIds = new Set<string>(),
  sizeScale = 'md',
  onFileContextMenu,
  onToggleFile
}: {
  files: FileItem[]
  selectedFileIds?: Set<string>
  sizeScale?: FileSizeScale
  onFileContextMenu?: (event: MouseEvent<HTMLElement>, file: FileItem) => void
  onToggleFile?: (file: FileItem) => void
}) {
  const cfg = scaleConfig[sizeScale]
  return (
    <div className={cn("mt-5 grid", cfg.grid)}>
      {files.map((file) => {
        const selected = selectedFileIds.has(file.id ?? '')
        return (
          <Card
            key={file.id ?? file.name}
            draggable
            onDragStart={(event) => { event.dataTransfer.setData('text/plain', file.id ?? ''); event.dataTransfer.effectAllowed = 'move' }}
            onClick={() => onToggleFile?.(file)}
            onContextMenu={(event) => onFileContextMenu?.(event, file)}
            className={cn(
              selected
                ? 'relative cursor-grab active:cursor-grabbing overflow-hidden file-selected shadow-sm transition hover:-translate-y-0.5 hover:shadow-md'
                : 'relative cursor-grab active:cursor-grabbing overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md',
              cfg.card
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <input type="checkbox" className={cn("shrink-0 accent-blue-600", cfg.checkbox)} checked={selected} onChange={() => onToggleFile?.(file)} onClick={(event) => event.stopPropagation()} />
              <button className={cn("flex shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-white/80", cfg.menuBtn)} onClick={(event) => { event.stopPropagation(); onFileContextMenu?.(event, file) }} aria-label={`Open ${file.name} menu`}><MoreVertical className="h-4 w-4" /></button>
            </div>

            <div className="flex justify-center mt-2">
              <div className={cn("flex items-center justify-center rounded-2xl bg-slate-100 text-slate-700", cfg.iconShell)}>
                <FileIcon kind={file.kind} className={cfg.icon} />
              </div>
            </div>

            <div className={cn("min-w-0 text-center", cfg.mtCard)}>
              <h3 className={cn("font-extrabold text-slate-950 line-clamp-2", cfg.title)} title={file.name}>{file.name}</h3>
              <p className={cfg.date}>{file.date}</p>
              <div className={cn("flex flex-wrap justify-center font-semibold text-slate-600", cfg.tagsShell)}>
                <span className={cn("rounded-full bg-slate-100", cfg.tag)}>{file.size}</span>
                <span className={cn("max-w-full truncate rounded-full bg-slate-100", cfg.tag)}>{file.access}</span>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
