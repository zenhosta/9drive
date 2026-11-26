import { useState } from 'react'
import {
  Archive,
  BookOpen,
  Box,
  Briefcase,
  Calendar,
  ChartColumn,
  Clock,
  Cloud,
  CloudDownload,
  CloudUpload,
  Code,
  Database,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileText,
  FileVideo,
  Files,
  Film,
  Folder,
  FolderOpen,
  Folders,
  GraduationCap,
  HardDrive,
  Headphones,
  Heart,
  Image,
  Images,
  Lock,
  Music,
  Notebook,
  Package,
  Receipt,
  Rocket,
  Server,
  Share2,
  Shield,
  Sparkles,
  Star,
  Terminal,
  UserCheck,
  Users,
  Video,
  Wallet,
} from 'lucide-react'
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
const folderIconUrlPrefix = 'https://api.iconify.design/lucide:'
export const defaultFolderIconUrl = `${folderIconUrlPrefix}folder.svg`

export const folderIconOptions = ([
  ['Folder', 'folder', Folder],
  ['Folder Open', 'folder-open', FolderOpen],
  ['Folders', 'folders', Folders],
  ['Files', 'files', Files],
  ['File Text', 'file-text', FileText],
  ['File Image', 'file-image', FileImage],
  ['File Video', 'file-video', FileVideo],
  ['File Music', 'file-music', FileMusic],
  ['File Code', 'file-code', FileCode],
  ['File Archive', 'file-archive', FileArchive],
  ['Briefcase', 'briefcase', Briefcase],
  ['Archive', 'archive', Archive],
  ['Cloud', 'cloud', Cloud],
  ['Cloud Upload', 'cloud-upload', CloudUpload],
  ['Cloud Download', 'cloud-download', CloudDownload],
  ['Hard Drive', 'hard-drive', HardDrive],
  ['Database', 'database', Database],
  ['Server', 'server', Server],
  ['Image', 'image', Image],
  ['Images', 'images', Images],
  ['Video', 'video', Video],
  ['Film', 'film', Film],
  ['Music', 'music', Music],
  ['Headphones', 'headphones', Headphones],
  ['Code', 'code', Code],
  ['Terminal', 'terminal', Terminal],
  ['Package', 'package', Package],
  ['Box', 'box', Box],
  ['Book Open', 'book-open', BookOpen],
  ['Notebook', 'notebook', Notebook],
  ['Graduation Cap', 'graduation-cap', GraduationCap],
  ['Receipt', 'receipt', Receipt],
  ['Wallet', 'wallet', Wallet],
  ['Chart', 'chart-column', ChartColumn],
  ['Calendar', 'calendar', Calendar],
  ['Clock', 'clock', Clock],
  ['Users', 'users', Users],
  ['User Check', 'user-check', UserCheck],
  ['Share', 'share-2', Share2],
  ['Lock', 'lock', Lock],
  ['Shield', 'shield', Shield],
  ['Star', 'star', Star],
  ['Heart', 'heart', Heart],
  ['Rocket', 'rocket', Rocket],
  ['Sparkles', 'sparkles', Sparkles],
] as const).map(([label, name, Icon]) => ({ label, url: `${folderIconUrlPrefix}${name}.svg`, Icon }))

const folderIconsByUrl = new Map(folderIconOptions.map(({ url, Icon }) => [url, Icon]))

export const folderColorOptions = ['#3b82f6', '#84cc16', '#22d3ee', '#facc15', '#f97316', '#ef4444', '#a855f7', '#14b8a6']

export function normalizeFolderColor(color?: string | null) {
  if (color?.startsWith('#')) return color
  return legacyColorMap[color ?? ''] ?? defaultFolderColor
}

export function FolderIcon({ iconUrl, color, className }: { iconUrl?: string | null; color: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const url = iconUrl || defaultFolderIconUrl
  const Icon = folderIconsByUrl.get(url.split(/[?#]/, 1)[0])
  if (Icon) return <Icon aria-hidden="true" className={className} style={{ color }} />

  if (url !== failedUrl) {
    const imageUrl = url.replace(folderIconUrlPrefix, 'https://api.iconify.design/lucide/')
    const separator = imageUrl.includes('?') ? '&' : '?'
    return <img src={`${imageUrl}${separator}color=${encodeURIComponent(color)}`} onError={() => setFailedUrl(url)} alt="" className={cn('object-contain', className)} />
  }

  return <Folder aria-hidden="true" className={className} style={{ color }} />
}

export function FolderVisual({ folder, className, iconClassName }: { folder: Pick<FolderItem, 'color' | 'iconUrl'>; className?: string; iconClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <FolderIcon iconUrl={folder.iconUrl} color={normalizeFolderColor(folder.color)} className={cn('h-full w-full', iconClassName)} />
    </span>
  )
}
