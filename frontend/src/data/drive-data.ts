export type FolderItem = {
  id?: string
  name: string
  updated: string
  color: string
  iconUrl?: string | null
  parentId?: string | null
  providerFolderId?: string | null
}

export type FileItem = {
  id?: string
  name: string
  mimeType?: string
  date: string
  size: string
  sizeBytes?: string
  access: string
  accountEmail?: string
  accountProvider?: string
  createdAt?: string
  kind: 'doc' | 'image' | 'video' | 'pdf'
  shared: number
  owner?: string
  location?: string
  archivedDate?: string
  starredDate?: string
  openedDate?: string
  folderId?: string | null
  folderName?: string | null
}

export const folders: FolderItem[] = [
  { name: 'Campaign Assets', updated: 'Last updated 2 days ago', color: 'text-lime-500' },
  { name: 'Presentation Decks', updated: 'Last updated 3 days ago', color: 'text-cyan-400' },
  { name: 'Brand Materials', updated: 'Last updated 4 days ago', color: 'text-yellow-400' },
  { name: 'Meeting Notes', updated: 'Last updated 5 days ago', color: 'text-orange-500' },
]

export const files: FileItem[] = [
  { name: 'Dribbble Design File', date: 'May 5, 2026, 10:04 PM', size: '381.72 KB', access: 'Only You', kind: 'doc', shared: 1, openedDate: 'Today, 09:42 AM', starredDate: 'Apr 30, 2026', location: 'All Files' },
  { name: 'Travel Landing Page', date: '--', size: '381.72 KB', access: '3 Members', kind: 'image', shared: 3, owner: 'Maya Putri', openedDate: 'Yesterday, 07:12 PM', location: 'Shared With Me' },
  { name: 'Wedding Video', date: 'May 5, 2026, 10:04 PM', size: '381.72 KB', access: 'Only You', kind: 'video', shared: 1, openedDate: 'May 7, 2026', location: 'Videos' },
  { name: 'Projects Brief', date: '--', size: '25.72 KB', access: 'Only You', kind: 'doc', shared: 1, starredDate: 'May 2, 2026', location: 'Projects' },
  { name: 'Resume Of Tushar Chowdhury.Pdf', date: 'May 5, 2026, 10:04 PM', size: '381.72 KB', access: 'Only You', kind: 'pdf', shared: 1, starredDate: 'May 3, 2026', location: 'Documents' },
  { name: 'Travel Video 2021', date: '--', size: '381.72 KB', access: 'Only You', kind: 'video', shared: 1, archivedDate: 'Apr 19, 2026', location: 'Videos' },
]

export const sharedFiles: FileItem[] = [
  { name: 'Client References', date: 'May 8, 2026', size: '2.4 MB', access: '5 Members', kind: 'doc', shared: 5, owner: 'Maya Putri' },
  { name: 'Team Contracts', date: 'May 7, 2026', size: '948 KB', access: '4 Members', kind: 'pdf', shared: 4, owner: 'Arif Rahman' },
  { name: 'Design Feedback', date: 'May 6, 2026', size: '1.1 MB', access: '3 Members', kind: 'image', shared: 3, owner: 'Lena Hartono' },
  { name: 'Product Walkthrough', date: 'May 4, 2026', size: '14.8 MB', access: '6 Members', kind: 'video', shared: 6, owner: 'Rizky Adam' },
]

export const archivedFiles: FileItem[] = [
  { name: 'Travel Video 2021', date: '--', size: '381.72 KB', access: 'Only You', kind: 'video', shared: 1, archivedDate: 'Apr 19, 2026', location: 'Videos' },
  { name: 'Q1 Expense Draft', date: 'Mar 12, 2026', size: '85.1 KB', access: 'Only You', kind: 'doc', shared: 1, archivedDate: 'Apr 11, 2026', location: 'Finance' },
  { name: 'Old Brand Snapshot', date: 'Feb 28, 2026', size: '2.1 MB', access: 'Only You', kind: 'image', shared: 1, archivedDate: 'Mar 29, 2026', location: 'Brand Materials' },
]

export const sharedFolders: FolderItem[] = [
  { name: 'Client References', updated: 'Shared yesterday', color: 'text-blue-500' },
  { name: 'Team Contracts', updated: 'Shared 2 days ago', color: 'text-lime-500' },
  { name: 'Design Feedback', updated: 'Shared 3 days ago', color: 'text-orange-500' },
]
