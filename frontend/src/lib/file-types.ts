import { Archive, File as FileGeneric, FileCode, FileImage, FilePlay, FileText, Music, Presentation, Table, type LucideIcon } from 'lucide-react'

/** Category keys and labels come from the API (single source of truth on the backend); only icons/colours live here. */
export type CategoryKey = 'images' | 'videos' | 'audio' | 'documents' | 'spreadsheets' | 'presentations' | 'archives' | 'code' | 'other'

export const categoryStyle: Record<CategoryKey, { icon: LucideIcon; tone: string }> = {
  images: { icon: FileImage, tone: 'bg-yellow-400 text-white' },
  videos: { icon: FilePlay, tone: 'bg-orange-500 text-white' },
  audio: { icon: Music, tone: 'bg-pink-500 text-white' },
  documents: { icon: FileText, tone: 'bg-blue-500 text-white' },
  spreadsheets: { icon: Table, tone: 'bg-emerald-500 text-white' },
  presentations: { icon: Presentation, tone: 'bg-red-500 text-white' },
  archives: { icon: Archive, tone: 'bg-amber-600 text-white' },
  code: { icon: FileCode, tone: 'bg-violet-500 text-white' },
  other: { icon: FileGeneric, tone: 'bg-slate-500 text-white' },
}

export const isCategoryKey = (value: string | null): value is CategoryKey => Boolean(value && value in categoryStyle)
