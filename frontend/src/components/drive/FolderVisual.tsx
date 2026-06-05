import { Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FolderItem } from '@/data/drive-data'

const legacyColorMap: Record<string, string> = {
  'text-blue-500': '#3b82f6',
  'text-lime-500': '#84cc16',
  'text-cyan-400': '#22d3ee',
  'text-yellow-400': '#facc15',
  'text-orange-500': '#f97316',
}

export const defaultFolderColor = '#3b82f6'
export const defaultFolderIconUrl = 'https://api.iconify.design/lucide:folder.svg'

export const folderIconOptions = [
  { label: 'Folder', url: defaultFolderIconUrl },
  { label: 'Folder Open', url: 'https://api.iconify.design/lucide:folder-open.svg' },
  { label: 'Folders', url: 'https://api.iconify.design/lucide:folders.svg' },
  { label: 'Files', url: 'https://api.iconify.design/lucide:files.svg' },
  { label: 'File Text', url: 'https://api.iconify.design/lucide:file-text.svg' },
  { label: 'File Image', url: 'https://api.iconify.design/lucide:file-image.svg' },
  { label: 'File Video', url: 'https://api.iconify.design/lucide:file-video.svg' },
  { label: 'File Music', url: 'https://api.iconify.design/lucide:file-music.svg' },
  { label: 'File Code', url: 'https://api.iconify.design/lucide:file-code.svg' },
  { label: 'File Archive', url: 'https://api.iconify.design/lucide:file-archive.svg' },
  { label: 'Briefcase', url: 'https://api.iconify.design/lucide:briefcase.svg' },
  { label: 'Archive', url: 'https://api.iconify.design/lucide:archive.svg' },
  { label: 'Cloud', url: 'https://api.iconify.design/lucide:cloud.svg' },
  { label: 'Cloud Upload', url: 'https://api.iconify.design/lucide:cloud-upload.svg' },
  { label: 'Cloud Download', url: 'https://api.iconify.design/lucide:cloud-download.svg' },
  { label: 'Hard Drive', url: 'https://api.iconify.design/lucide:hard-drive.svg' },
  { label: 'Database', url: 'https://api.iconify.design/lucide:database.svg' },
  { label: 'Server', url: 'https://api.iconify.design/lucide:server.svg' },
  { label: 'Image', url: 'https://api.iconify.design/lucide:image.svg' },
  { label: 'Images', url: 'https://api.iconify.design/lucide:images.svg' },
  { label: 'Video', url: 'https://api.iconify.design/lucide:video.svg' },
  { label: 'Film', url: 'https://api.iconify.design/lucide:film.svg' },
  { label: 'Music', url: 'https://api.iconify.design/lucide:music.svg' },
  { label: 'Headphones', url: 'https://api.iconify.design/lucide:headphones.svg' },
  { label: 'Code', url: 'https://api.iconify.design/lucide:code.svg' },
  { label: 'Terminal', url: 'https://api.iconify.design/lucide:terminal.svg' },
  { label: 'Package', url: 'https://api.iconify.design/lucide:package.svg' },
  { label: 'Box', url: 'https://api.iconify.design/lucide:box.svg' },
  { label: 'Book Open', url: 'https://api.iconify.design/lucide:book-open.svg' },
  { label: 'Notebook', url: 'https://api.iconify.design/lucide:notebook.svg' },
  { label: 'Graduation Cap', url: 'https://api.iconify.design/lucide:graduation-cap.svg' },
  { label: 'Receipt', url: 'https://api.iconify.design/lucide:receipt.svg' },
  { label: 'Wallet', url: 'https://api.iconify.design/lucide:wallet.svg' },
  { label: 'Chart', url: 'https://api.iconify.design/lucide:chart-column.svg' },
  { label: 'Calendar', url: 'https://api.iconify.design/lucide:calendar.svg' },
  { label: 'Clock', url: 'https://api.iconify.design/lucide:clock.svg' },
  { label: 'Users', url: 'https://api.iconify.design/lucide:users.svg' },
  { label: 'User Check', url: 'https://api.iconify.design/lucide:user-check.svg' },
  { label: 'Share', url: 'https://api.iconify.design/lucide:share-2.svg' },
  { label: 'Lock', url: 'https://api.iconify.design/lucide:lock.svg' },
  { label: 'Shield', url: 'https://api.iconify.design/lucide:shield.svg' },
  { label: 'Star', url: 'https://api.iconify.design/lucide:star.svg' },
  { label: 'Heart', url: 'https://api.iconify.design/lucide:heart.svg' },
  { label: 'Rocket', url: 'https://api.iconify.design/lucide:rocket.svg' },
  { label: 'Sparkles', url: 'https://api.iconify.design/lucide:sparkles.svg' },
]

export const folderColorOptions = ['#3b82f6', '#84cc16', '#22d3ee', '#facc15', '#f97316', '#ef4444', '#a855f7', '#14b8a6']

export function normalizeFolderColor(color?: string | null) {
  if (color?.startsWith('#')) return color
  return legacyColorMap[color ?? ''] ?? defaultFolderColor
}

export function iconUrlWithColor(iconUrl: string, color: string) {
  const separator = iconUrl.includes('?') ? '&' : '?'
  return `${iconUrl}${separator}color=${encodeURIComponent(color)}`
}

export function FolderVisual({ folder, className, iconClassName }: { folder: Pick<FolderItem, 'color' | 'iconUrl'>; className?: string; iconClassName?: string }) {
  const color = normalizeFolderColor(folder.color)
  const iconUrl = folder.iconUrl || defaultFolderIconUrl
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      {iconUrl ? <img src={iconUrlWithColor(iconUrl, color)} alt="" className={cn('h-full w-full object-contain', iconClassName)} /> : <Folder className={cn('h-full w-full fill-current stroke-current', iconClassName)} style={{ color }} />}
    </span>
  )
}
