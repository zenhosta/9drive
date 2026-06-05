import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, CheckCircle, ChevronDown, ClipboardPaste, Folder, FolderInput, FolderPlus, LayoutGrid, List, MoreVertical, Star, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { EmptyAreaContextMenu } from '@/components/drive/EmptyAreaContextMenu'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { FileDetailsDrawer } from '@/components/drive/FileDetailsDrawer'
import { FileGrid } from '@/components/drive/FileGrid'
import { FileTable } from '@/components/drive/FileTable'
import { FolderContextMenu } from '@/components/drive/FolderContextMenu'
import { FolderGrid } from '@/components/drive/FolderGrid'
import { PageHeader } from '@/components/drive/PageHeader'
import { Input } from '@/components/ui/input'
import { API_URL, apiFetch, formatBytes, formatDate } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { createPlyr, ensurePlyr } from '@/lib/plyr'
import type { FileItem, FolderItem } from '@/data/drive-data'

type BackendFile = { id: string; name: string; mimeType: string; sizeBytes: string; createdAt: string; folderId?: string | null; connectedAccount?: { email: string; provider: string }; folder?: { id: string; name: string } | null }
type BackendFolder = { id: string; name: string; color: string; parentId?: string | null; updatedAt: string }
type UploadProgressStatus = 'uploading' | 'done' | 'error' | 'partial'
type UploadProgressFile = { name: string; size: number; percent: number; status: UploadProgressStatus }
type UploadProgressState = { open: boolean; fileName: string; percent: number; status: UploadProgressStatus; files: UploadProgressFile[] }
type UploadResult = { file?: unknown; files?: unknown[]; failed?: Array<{ fileName?: string }> }
type FileViewMode = 'list' | 'grid'

const folderColors = ['text-blue-500', 'text-lime-500', 'text-cyan-400', 'text-yellow-400', 'text-orange-500']
const fileViewStorageKey = '9drive:all-files-view-mode'

function getStoredFileViewMode(): FileViewMode {
  const stored = localStorage.getItem(fileViewStorageKey)
  return stored === 'grid' || stored === 'list' ? stored : 'list'
}

function mimeToKind(mimeType: string): FileItem['kind'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.includes('pdf')) return 'pdf'
  return 'doc'
}

function previewKind(mimeType: string | undefined) {
  if (!mimeType) return null
  if (mimeType.startsWith('image/') || mimeType === 'application/vnd.google-apps.drawing') return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType === 'application/pdf' || mimeType === 'application/vnd.google-apps.document' || mimeType === 'application/vnd.google-apps.presentation') return 'document'
  return null
}

function mapFile(file: BackendFile): FileItem {
  return { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt, accountEmail: file.connectedAccount?.email, accountProvider: file.connectedAccount?.provider, date: formatDate(file.createdAt), size: formatBytes(file.sizeBytes), access: file.connectedAccount?.email ?? 'Google Drive', kind: mimeToKind(file.mimeType), shared: 1, folderId: file.folderId, folderName: file.folder?.name }
}

function mapFolder(folder: BackendFolder): FolderItem {
  return { id: folder.id, name: folder.name, color: folder.color, updated: `Updated ${formatDate(folder.updatedAt)}` }
}

function estimateUploadProgress(files: File[], percent: number, status: UploadProgressStatus): UploadProgressFile[] {
  const totalBytes = Math.max(files.reduce((total, file) => total + file.size, 0), 1)
  let loadedBytes = (totalBytes * percent) / 100
  return files.map((file) => {
    const loadedForFile = Math.min(file.size, Math.max(0, loadedBytes))
    loadedBytes -= file.size
    return { name: file.name, size: file.size, percent: status === 'done' ? 100 : Math.min(99, Math.round((loadedForFile / Math.max(file.size, 1)) * 100)), status }
  })
}

export function AllFilesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeFolderId = searchParams.get('folderId')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [folderRenameOpen, setFolderRenameOpen] = useState(false)
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [copiedShareLink, setCopiedShareLink] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [files, setFiles] = useState<FileItem[]>([])
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [allFolders, setAllFolders] = useState<FolderItem[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [isUploadDragging, setIsUploadDragging] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderColor, setFolderColor] = useState('text-blue-500')
  const [renameValue, setRenameValue] = useState('')
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [folderRenameColor, setFolderRenameColor] = useState('text-blue-500')
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const [activeFolderForMenu, setActiveFolderForMenu] = useState<FolderItem | null>(null)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [cutFolder, setCutFolder] = useState<FolderItem | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem | null }>({ x: 0, y: 0, file: null })
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folder: FolderItem | null }>({ x: 0, y: 0, folder: null })
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number; open: boolean }>({ x: 0, y: 0, open: false })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>(getStoredFileViewMode)
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({ open: false, fileName: '', percent: 0, status: 'uploading', files: [] })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviteTargetType, setInviteTargetType] = useState<'file' | 'folder'>('file')
  const [inviteTargetId, setInviteTargetId] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviting, setInviting] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)

  async function loadFiles() {
    const path = activeFolderId ? `/files?folderId=${activeFolderId}` : '/files'
    const data = await apiFetch<{ files: BackendFile[] }>(path)
    setFiles(data.files.map(mapFile))
  }

  async function loadFolders() {
    const visiblePath = activeFolderId ? `/folders?parentId=${activeFolderId}` : '/folders'
    const [visibleData, allData] = await Promise.all([
      apiFetch<{ folders: BackendFolder[] }>(visiblePath),
      apiFetch<{ folders: BackendFolder[] }>('/folders?all=1'),
    ])
    setFolders(visibleData.folders.map(mapFolder))
    setAllFolders(allData.folders.map(mapFolder))
  }

  async function loadAll() {
    await Promise.all([loadFiles(), loadFolders()])
  }

  useEffect(() => {
    loadAll().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load files'))
    setSelectedFileIds(new Set())
  }, [activeFolderId])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextMenu({ x: 0, y: 0, file: null })
      if (event.key === 'Escape') setFolderContextMenu({ x: 0, y: 0, folder: null })
      if (event.key === 'Escape') setEmptyContextMenu({ x: 0, y: 0, open: false })
      if (event.ctrlKey && event.key.toLowerCase() === 'x' && activeFolderForMenu) {
        event.preventDefault()
        cutSelectedFolder(activeFolderForMenu)
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && cutFolder) {
        event.preventDefault()
        pasteFolder().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to paste folder'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFolderForMenu, cutFolder, activeFolderId])

  useEffect(() => {
    if (!previewOpen || !activeFile?.mimeType?.startsWith('video/') || !previewVideoRef.current) return undefined
    let disposed = false
    let player: { destroy: () => void } | null = null

    ensurePlyr().then(() => {
      if (disposed || !previewVideoRef.current) return
      player = createPlyr(previewVideoRef.current)
    }).catch(() => undefined)

    return () => {
      disposed = true
      player?.destroy()
    }
  }, [previewOpen, activeFile?.mimeType, previewUrl])

  async function createFolder(event: FormEvent) {
    event.preventDefault()
    await apiFetch('/folders', { method: 'POST', body: JSON.stringify({ name: folderName, color: folderColor, parentId: activeFolderId ?? null }) })
    setFolderName('')
    setFolderColor('text-blue-500')
    setFolderOpen(false)
    await loadFolders()
  }

  async function uploadFile(event: FormEvent) {
    event.preventDefault()
    if (selectedFiles.length === 0) return
    setLoading(true)
    setMessage('')
    try {
      const form = new FormData()
      const targetFolderId = activeFolderId || selectedFolderId
      const filesMeta = selectedFiles.map((file, index) => ({ fieldName: `file-${index}`, fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: String(file.size), folderId: targetFolderId || undefined }))
      form.append('filesMeta', JSON.stringify(filesMeta))
      selectedFiles.forEach((file, index) => form.append(`file-${index}`, file))
      const uploadingFiles = [...selectedFiles]
      setUploadProgress({ open: true, fileName: uploadingFiles.length === 1 ? uploadingFiles[0].name : `${uploadingFiles.length} files`, percent: 0, status: 'uploading', files: estimateUploadProgress(uploadingFiles, 0, 'uploading') })
      const uploadResult = await uploadWithProgress(form, (percent) => setUploadProgress((current) => ({ ...current, percent, files: estimateUploadProgress(uploadingFiles, percent, 'uploading') })))
      const uploadedCount = uploadResult.files?.length ?? (uploadResult.file ? 1 : selectedFiles.length)
      const failedCount = uploadResult.failed?.length ?? 0
      const failedNames = new Set((uploadResult.failed ?? []).map((file) => file.fileName).filter(Boolean))
      setUploadProgress((current) => ({ ...current, percent: 100, status: failedCount > 0 ? 'partial' : 'done', files: uploadingFiles.map((file) => ({ name: file.name, size: file.size, percent: failedNames.has(file.name) ? 0 : 100, status: failedNames.has(file.name) ? 'error' : 'done' })) }))
      setSelectedFiles([])
      setSelectedFolderId('')
      setUploadOpen(false)
      setMessage(failedCount > 0 ? `${uploadedCount} files uploaded. ${failedCount} failed.` : selectedFiles.length === 1 ? 'File uploaded to Google Drive.' : `${uploadedCount} files uploaded to Google Drive.`)
      await loadFiles()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setUploadProgress((current) => ({ ...current, status: 'error', files: current.files.map((file) => ({ ...file, status: 'error' })) }))
      setMessage(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  function selectUploadFiles(files: FileList | File[] | null | undefined) {
    if (!files) return
    const nextFiles = Array.from(files)
    if (nextFiles.length === 0) return
    setSelectedFiles(nextFiles)
  }

  function removeUploadFile(index: number) {
    setSelectedFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))
  }

  function handleUploadDrag(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') setIsUploadDragging(true)
    if (event.type === 'dragleave' || event.type === 'drop') setIsUploadDragging(false)
    if (event.type === 'drop') selectUploadFiles(event.dataTransfer.files)
  }

  function uploadWithProgress(form: FormData, onProgress: (percent: number) => void) {
    return new Promise<UploadResult>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', `${API_URL}/uploads`)
      const token = getAccessToken()
      if (token) request.setRequestHeader('Authorization', `Bearer ${token}`)
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) resolve(JSON.parse(request.responseText || '{}') as UploadResult)
        else {
          const error = JSON.parse(request.responseText || '{}') as { message?: string }
          reject(new Error(error.message ?? 'Upload failed'))
        }
      }
      request.onerror = () => reject(new Error('Upload failed'))
      request.send(form)
    })
  }

  function openContext(event: MouseEvent<HTMLElement>, file: FileItem) {
    event.preventDefault()
    event.stopPropagation()
    setActiveFile(file)
    setContextMenu({ x: event.clientX, y: event.clientY, file })
  }

  function toggleFileSelection(file: FileItem) {
    if (!file.id) return
    setSelectedFileIds((current) => {
      const next = new Set(current)
      if (next.has(file.id!)) next.delete(file.id!)
      else next.add(file.id!)
      return next
    })
  }

  function toggleAllVisibleFiles() {
    const visibleIds = files.map((file) => file.id).filter(Boolean) as string[]
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedFileIds.has(id))
    setSelectedFileIds(allSelected ? new Set() : new Set(visibleIds))
  }

  function clearSelection() {
    setSelectedFileIds(new Set())
  }

  function changeFileViewMode(mode: FileViewMode) {
    setFileViewMode(mode)
    localStorage.setItem(fileViewStorageKey, mode)
  }

  function openFolderMenu(event: MouseEvent<HTMLElement>, folder: FolderItem) {
    event.preventDefault()
    event.stopPropagation()
    setActiveFolderForMenu(folder)
    setFolderContextMenu({ x: event.clientX, y: event.clientY, folder })
  }

  function openFolder(folder: FolderItem) {
    if (!folder.id) return
    setSearchParams({ folderId: folder.id })
  }

  function openEmptyContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setEmptyContextMenu({ x: event.clientX, y: event.clientY, open: true })
  }

  function closeFolder() {
    setSearchParams({})
  }

  async function viewFile() {
    if (!activeFile?.id) return
    const data = await apiFetch<{ url: string }>(`/files/${activeFile.id}/share`, { method: 'POST' })
    const previewPath = new URL(data.url).pathname.replace(/\/embed$/, '')
    setPreviewUrl(`${API_URL}${previewPath}/preview`)
    setPreviewOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function downloadFile() {
    if (!activeFile?.id) return
    const response = await fetch(`${API_URL}/files/${activeFile.id}/download`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
    if (!response.ok) throw new Error('Download failed')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = activeFile.name
    link.click()
    URL.revokeObjectURL(url)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function renameFile(event: FormEvent) {
    event.preventDefault()
    if (!activeFile?.id) return
    await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue }) })
    setRenameOpen(false)
    await loadFiles()
  }

  async function moveFile(event: FormEvent) {
    event.preventDefault()
    const selectedIds = [...selectedFileIds]
    if (selectedIds.length > 0) await apiFetch('/files/batch', { method: 'PATCH', body: JSON.stringify({ fileIds: selectedIds, folderId: selectedFolderId || null }) })
    else if (activeFile?.id) await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ folderId: selectedFolderId || null }) })
    else return
    setMoveOpen(false)
    setSelectedFolderId('')
    clearSelection()
    await loadFiles()
  }

  async function deleteFile() {
    const selectedIds = [...selectedFileIds]
    if (selectedIds.length > 0) await apiFetch('/files/batch', { method: 'DELETE', body: JSON.stringify({ fileIds: selectedIds }) })
    else if (activeFile?.id) await apiFetch(`/files/${activeFile.id}`, { method: 'DELETE' })
    else return
    setDeleteOpen(false)
    clearSelection()
    await loadFiles()
    window.dispatchEvent(new Event('9drive:storage-changed'))
  }

  async function shareFile() {
    if (!activeFile?.id) return
    const data = await apiFetch<{ url: string }>(`/files/${activeFile.id}/share`, { method: 'POST' })
    setShareUrl(data.url)
    setCopiedShareLink(false)
    setShareOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function inviteToFile() {
    if (!activeFile?.id) return
    setInviteTargetType('file')
    setInviteTargetId(activeFile.id)
    setInviteOpen(true)
    setContextMenu({ x: 0, y: 0, file: null })
  }

  async function inviteToFolder() {
    if (!activeFolderForMenu?.id) return
    setInviteTargetType('folder')
    setInviteTargetId(activeFolderForMenu.id)
    setInviteOpen(true)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault()
    if (!inviteTargetId) return
    setInviting(true)
    setInviteMessage('')
    try {
      await apiFetch('/invites', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole, targetType: inviteTargetType, targetId: inviteTargetId }) })
      setInviteEmail('')
      setInviteRole('viewer')
      setInviteMessage('Invite saved. Member will appear in Shared.')
      window.dispatchEvent(new Event('9drive:invites-changed'))
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(shareUrl)
    setCopiedShareLink(true)
    window.setTimeout(() => setCopiedShareLink(false), 1600)
  }

  async function renameFolder(event: FormEvent) {
    event.preventDefault()
    if (!activeFolderForMenu?.id) return
    await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'PATCH', body: JSON.stringify({ name: folderRenameValue, color: folderRenameColor }) })
    setFolderRenameOpen(false)
    await loadFolders()
  }

  async function deleteFolder() {
    if (!activeFolderForMenu?.id) return
    await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'DELETE' })
    setFolderDeleteOpen(false)
    await loadFolders()
  }

  function cutSelectedFolder(folder: FolderItem | null) {
    if (!folder?.id) return
    setCutFolder(folder)
    setFolderContextMenu({ x: 0, y: 0, folder: null })
    setMessage(`Folder "${folder.name}" ready to move. Open target folder and press Ctrl+V.`)
  }

  async function pasteFolder() {
    if (!cutFolder?.id) return
    await apiFetch(`/folders/${cutFolder.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: activeFolderId ?? null }) })
    setMessage(`Folder "${cutFolder.name}" moved.`)
    setCutFolder(null)
    await loadFolders()
  }

  function closePreview() {
    setPreviewUrl('')
    setPreviewOpen(false)
  }

  const recentFolders = folders.slice(0, 4)
  const moreFolders = folders.slice(4)
  const activeFolder = allFolders.find((folder) => folder.id === activeFolderId)
  const allVisibleSelected = files.length > 0 && files.every((file) => file.id && selectedFileIds.has(file.id))
  const uploadPanelTitle = uploadProgress.status === 'done' ? 'Upload complete' : uploadProgress.status === 'partial' ? 'Upload completed with errors' : uploadProgress.status === 'error' ? 'Upload failed' : uploadProgress.percent >= 99 ? 'Processing on server' : 'Uploading files'
  const activePreviewKind = previewKind(activeFile?.mimeType)

  return (
    <>
      <div onContextMenu={openEmptyContextMenu} className="min-h-[620px] w-full min-w-0">
      <PageHeader title={activeFolder ? <span className="block min-w-0 truncate"><button className="text-blue-600 hover:underline" onClick={closeFolder}>All Files</button><span className="text-slate-400"> / </span><span>{activeFolder.name}</span></span> : 'All Files'} actions={<><Button className="w-full" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" />Upload</Button><Button className="w-full" variant="outline" onClick={() => setFolderOpen(true)}><FolderPlus className="h-4 w-4" />New Folder</Button></>} />
      {message ? <p className="mt-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      {!activeFolder && (recentFolders.length > 0 ? <FolderGrid items={recentFolders} mobileTwoColumns onFolderMenu={openFolderMenu} onFolderOpen={openFolder} /> : <p className="mt-8 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No folders yet. Click New Folder to organize uploads.</p>)}
      {!activeFolder && moreFolders.length > 0 ? <Card className="mt-5 p-4 sm:p-5"><h2 className="font-extrabold">More Folders</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{moreFolders.map((folder) => <div key={folder.id} onClick={() => openFolder(folder)} onContextMenu={(event) => openFolderMenu(event, folder)} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 hover:bg-slate-100"><div className="flex min-w-0 items-center gap-3"><Folder className="h-5 w-5 shrink-0 text-blue-600" /><div className="min-w-0"><p className="truncate font-semibold">{folder.name}</p><p className="truncate text-xs text-slate-500">{folder.updated}</p></div></div><button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-white sm:h-8 sm:w-8 sm:rounded-lg" onClick={(event) => { event.stopPropagation(); openFolderMenu(event, folder) }} aria-label={`Open ${folder.name} menu`}><MoreVertical className="h-5 w-5" /></button></div>)}</div></Card> : null}
      <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3"><Button variant="soft" className="hidden sm:inline-flex"><Archive className="h-4 w-4" />Recents</Button><Button variant="soft" className="hidden sm:inline-flex"><Star className="h-4 w-4" />Starred</Button>{selectedFileIds.size > 0 ? <div className="flex w-full flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 sm:w-auto sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0"><span className="text-sm font-extrabold text-slate-700">{selectedFileIds.size} selected</span><div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3"><Button className="w-full" variant="outline" onClick={() => setMoveOpen(true)}><FolderInput className="h-4 w-4" />Move</Button><Button className="w-full" variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4" />Delete</Button><Button className="w-full" variant="ghost" onClick={clearSelection}>Clear</Button></div></div> : null}</div>
        <div className="flex gap-3"><Button variant={fileViewMode === 'grid' ? 'soft' : 'outline'} size="icon" aria-label="Show files as grid" aria-pressed={fileViewMode === 'grid'} onClick={() => changeFileViewMode('grid')}><LayoutGrid className="h-5 w-5" /></Button><Button variant={fileViewMode === 'list' ? 'soft' : 'outline'} size="icon" aria-label="Show files as list" aria-pressed={fileViewMode === 'list'} onClick={() => changeFileViewMode('list')}><List className="h-5 w-5" /></Button></div>
      </div>
      {cutFolder ? <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-700"><ClipboardPaste className="mr-2 inline h-4 w-4" />Cut folder: {cutFolder.name}. Press Ctrl+V or right-click empty area to paste here.</p> : null}
      {files.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">{activeFolder ? 'No files in this folder yet.' : 'No uploaded files yet. Connect Google Drive in Settings, then upload a file.'}</p> : fileViewMode === 'grid' ? <FileGrid files={files} selectedFileIds={selectedFileIds} onToggleFile={toggleFileSelection} onFileContextMenu={openContext} /> : <FileTable files={files} selectedFileIds={selectedFileIds} allSelected={allVisibleSelected} onToggleFile={toggleFileSelection} onToggleAll={toggleAllVisibleFiles} onFileContextMenu={openContext} />}
      </div>
      <EmptyAreaContextMenu x={emptyContextMenu.x} y={emptyContextMenu.y} open={emptyContextMenu.open} canPasteFolder={Boolean(cutFolder)} onClose={() => setEmptyContextMenu({ x: 0, y: 0, open: false })} onUpload={() => { setUploadOpen(true); setEmptyContextMenu({ x: 0, y: 0, open: false }) }} onCreateFolder={() => { setFolderOpen(true); setEmptyContextMenu({ x: 0, y: 0, open: false }) }} onPasteFolder={() => { pasteFolder().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to paste folder')); setEmptyContextMenu({ x: 0, y: 0, open: false }) }} />
      <FileContextMenu x={contextMenu.x} y={contextMenu.y} file={contextMenu.file} onClose={() => setContextMenu({ x: 0, y: 0, file: null })} onView={viewFile} onDownload={downloadFile} onRename={() => { setRenameValue(activeFile?.name ?? ''); setRenameOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onMove={() => { setMoveOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onDetails={() => { setDetailOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} onShare={shareFile} onInvite={inviteToFile} onDelete={() => { setDeleteOpen(true); setContextMenu({ x: 0, y: 0, file: null }) }} />
      <FolderContextMenu x={folderContextMenu.x} y={folderContextMenu.y} folder={folderContextMenu.folder} onClose={() => setFolderContextMenu({ x: 0, y: 0, folder: null })} onCut={() => cutSelectedFolder(activeFolderForMenu)} onRename={() => { setFolderRenameValue(activeFolderForMenu?.name ?? ''); setFolderRenameColor(activeFolderForMenu?.color ?? 'text-blue-500'); setFolderRenameOpen(true); setFolderContextMenu({ x: 0, y: 0, folder: null }) }} onInvite={inviteToFolder} onDelete={() => { setFolderDeleteOpen(true); setFolderContextMenu({ x: 0, y: 0, folder: null }) }} />
      <FileDetailsDrawer open={detailOpen} file={activeFile} onClose={() => setDetailOpen(false)} />

      <DummyModal open={uploadOpen} title="Upload File" description="Stream file directly to selected Google Drive account." onClose={() => setUploadOpen(false)}>
        <form onSubmit={uploadFile} className="grid gap-4">
           <label onDragEnter={handleUploadDrag} onDragOver={handleUploadDrag} onDragLeave={handleUploadDrag} onDrop={handleUploadDrag} className={isUploadDragging ? 'grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-blue-500 bg-blue-50 p-4 text-center transition sm:p-6' : 'grid cursor-pointer gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center transition hover:border-blue-300 hover:bg-blue-50/50 sm:p-6'}>
            <Upload className={isUploadDragging ? 'mx-auto h-8 w-8 text-blue-600' : 'mx-auto h-8 w-8 text-slate-500'} />
            <span className="text-sm font-extrabold text-slate-950">Drop file here or click to browse</span>
            <span className="text-xs text-slate-500">Metadata is sent before the file so upload can stream directly to Google Drive.</span>
            <Input type="file" className="sr-only" multiple onChange={(event) => selectUploadFiles(event.target.files)} required={selectedFiles.length === 0} />
          </label>
          {activeFolder ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Uploading to: <b>{activeFolder.name}</b></p> : <label className="grid gap-2 text-sm font-semibold">Virtual Folder<select className="h-11 rounded-xl border border-slate-200 px-3 text-sm" value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}><option value="">No folder</option>{allFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
          {selectedFiles.length > 0 ? <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><div className="flex items-center justify-between gap-3"><span className="font-bold text-slate-950">{selectedFiles.length} selected</span><span className="shrink-0">{formatBytes(selectedFiles.reduce((total, file) => total + file.size, 0))}</span></div>{selectedFiles.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="shrink-0 text-xs text-slate-500">{formatBytes(file.size)}</span><button type="button" className="shrink-0 text-slate-500 hover:text-red-600" onClick={() => removeUploadFile(index)} aria-label={`Remove ${file.name}`}><X className="h-4 w-4" /></button></div>)}</div> : null}
          <div className="grid gap-3 sm:flex sm:justify-end"><Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button><Button disabled={loading || selectedFiles.length === 0}>{loading ? 'Uploading...' : `Upload${selectedFiles.length > 1 ? ` ${selectedFiles.length} files` : ''}`}</Button></div>
        </form>
      </DummyModal>
       <DummyModal open={folderOpen} title="New Folder" description="Create a virtual folder for organizing files." onClose={() => setFolderOpen(false)}>
        <form onSubmit={createFolder} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">Folder Name<Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="Project Assets" required /></label>
          <div className="grid gap-2 text-sm font-semibold"><span>Folder Color</span><div className="flex flex-wrap gap-2">{folderColors.map((color) => <button key={color} type="button" onClick={() => setFolderColor(color)} className={folderColor === color ? 'h-8 w-8 rounded-lg border-2 border-blue-600 bg-slate-50' : 'h-8 w-8 rounded-lg border border-slate-200 bg-slate-50'}><Folder className={`mx-auto h-5 w-5 fill-current ${color}`} /></button>)}</div></div>
          <div className="grid gap-3 pt-2 sm:flex sm:justify-end"><Button type="button" variant="outline" onClick={() => setFolderOpen(false)}>Cancel</Button><Button>Create Folder</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={renameOpen} title="Rename File" description={activeFile?.name ?? ''} onClose={() => setRenameOpen(false)}><form onSubmit={renameFile} className="grid gap-4"><Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required /><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button><Button>Rename</Button></div></form></DummyModal>
      <DummyModal open={moveOpen} title="Move to Folder" description={selectedFileIds.size > 0 ? `Move ${selectedFileIds.size} files` : activeFile?.name ?? ''} onClose={() => setMoveOpen(false)}><form onSubmit={moveFile} className="grid gap-4"><select className="h-11 rounded-xl border border-slate-200 px-3 text-sm" value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}><option value="">No folder</option>{allFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button><Button>Move</Button></div></form></DummyModal>
      <DummyModal open={deleteOpen} title={selectedFileIds.size > 0 ? 'Delete Files' : 'Delete File'} description={selectedFileIds.size > 0 ? `Delete ${selectedFileIds.size} files from Google Drive?` : `Delete ${activeFile?.name ?? 'file'} from Google Drive?`} onClose={() => setDeleteOpen(false)}><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={deleteFile}>Delete</Button></div></DummyModal>
      <DummyModal open={shareOpen} title="Share Link" description={activeFile?.name ?? ''} onClose={() => setShareOpen(false)}><div className="grid gap-4"><Input value={shareUrl} readOnly /><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setShareOpen(false)}>Close</Button><Button onClick={copyShareLink}>{copiedShareLink ? <CheckCircle className="h-4 w-4" /> : null}{copiedShareLink ? 'Copied!' : 'Copy Link'}</Button></div>{copiedShareLink ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">Share link copied to clipboard.</p> : null}</div></DummyModal>
      <DummyModal open={folderRenameOpen} title="Rename Folder" description={activeFolderForMenu?.name ?? ''} onClose={() => setFolderRenameOpen(false)}><form onSubmit={renameFolder} className="grid gap-4"><Input value={folderRenameValue} onChange={(event) => setFolderRenameValue(event.target.value)} required /><div className="grid gap-2 text-sm font-semibold"><span>Folder Color</span><div className="flex flex-wrap gap-2">{folderColors.map((color) => <button key={color} type="button" onClick={() => setFolderRenameColor(color)} className={folderRenameColor === color ? 'h-8 w-8 rounded-lg border-2 border-blue-600 bg-slate-50' : 'h-8 w-8 rounded-lg border border-slate-200 bg-slate-50'}><Folder className={`mx-auto h-5 w-5 fill-current ${color}`} /></button>)}</div></div><div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setFolderRenameOpen(false)}>Cancel</Button><Button>Rename</Button></div></form></DummyModal>
      <DummyModal open={folderDeleteOpen} title="Delete Folder" description={`Delete virtual folder ${activeFolderForMenu?.name ?? ''}? Files inside will remain uploaded.`} onClose={() => setFolderDeleteOpen(false)}><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setFolderDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={deleteFolder}>Delete</Button></div></DummyModal>
      <DummyModal open={inviteOpen} title="Invite Member" description={`Share ${inviteTargetType === 'file' ? (activeFile?.name ?? 'file') : (activeFolderForMenu?.name ?? 'folder')} with a team member.`} onClose={() => setInviteOpen(false)}>
        <form onSubmit={sendInvite} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">Email Address<Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" required /></label>
          <label className="grid gap-2 text-sm font-semibold">Role<select className="h-11 rounded-xl border border-slate-200 px-3 text-sm" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="viewer">Can view</option><option value="editor">Can edit</option></select></label>
          {inviteMessage ? <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-700">{inviteMessage}</p> : null}
          <div className="flex justify-end gap-3 pt-2"><Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button><Button disabled={inviting}>{inviting ? 'Sending...' : 'Send Invite'}</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={previewOpen} title="File Preview" description={activeFile?.name ?? ''} onClose={closePreview} className="max-w-5xl">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {activePreviewKind === 'image' ? <img src={previewUrl} alt={activeFile?.name ?? 'File preview'} className="max-h-[70vh] w-full object-contain" /> : null}
          {activePreviewKind === 'video' ? <video ref={previewVideoRef} controls playsInline preload="metadata" className="max-h-[70vh] w-full"><source src={previewUrl} type={activeFile?.mimeType} /></video> : null}
          {activePreviewKind === 'document' ? <iframe src={previewUrl} title={activeFile?.name ?? 'File preview'} className="h-[70vh] w-full" /> : null}
          {!activePreviewKind ? <div className="p-6 text-center text-sm text-slate-500">Preview not available for this file type. Use Download instead.</div> : null}
        </div>
      </DummyModal>
       {uploadProgress.open ? (
        <div className="fixed inset-x-3 bottom-3 z-[70] max-h-[70dvh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[min(420px,calc(100vw-2.5rem))]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 font-extrabold">
              {uploadProgress.status === 'done' ? <CheckCircle className="h-5 w-5 text-emerald-500" /> : uploadProgress.status === 'partial' || uploadProgress.status === 'error' ? <X className="h-5 w-5 text-red-500" /> : <Upload className="h-5 w-5 text-blue-600" />}
              {uploadPanelTitle}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronDown className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setUploadProgress((current) => ({ ...current, open: false }))}><X className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="truncate font-semibold">{uploadProgress.fileName}</p>
              <span className="text-slate-500">{uploadProgress.percent}%</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-100">
              <div className={uploadProgress.status === 'error' || uploadProgress.status === 'partial' ? 'h-full rounded-full bg-red-500' : uploadProgress.status === 'done' ? 'h-full rounded-full bg-emerald-500' : 'h-full rounded-full bg-blue-600'} style={{ width: `${uploadProgress.percent}%` }} />
            </div>
            {uploadProgress.files.length > 0 ? <div className="mt-4 grid max-h-64 gap-3 overflow-y-auto pr-1">{uploadProgress.files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="grid gap-1 rounded-xl bg-slate-50 p-3"><div className="flex min-w-0 items-center justify-between gap-3 text-sm"><p className="min-w-0 flex-1 truncate font-semibold" title={file.name}>{file.name}</p><span className="shrink-0 text-xs text-slate-500">{file.percent}%</span></div><div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{formatBytes(file.size)}</span><span className={file.status === 'error' ? 'font-semibold text-red-600' : file.status === 'done' ? 'font-semibold text-emerald-600' : 'font-semibold text-blue-600'}>{file.status === 'error' ? 'Failed' : file.status === 'done' ? 'Done' : file.percent >= 99 ? 'Processing' : 'Uploading'}</span></div><div className="h-1.5 rounded-full bg-slate-200"><div className={file.status === 'error' ? 'h-full rounded-full bg-red-500' : file.status === 'done' ? 'h-full rounded-full bg-emerald-500' : 'h-full rounded-full bg-blue-600'} style={{ width: `${file.percent}%` }} /></div></div>)}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
