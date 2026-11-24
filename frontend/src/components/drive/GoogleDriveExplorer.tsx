import { useEffect, useState } from 'react'
import { ExternalLink, File, Folder, FolderPlus, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { DummyModal } from './DummyModal'
import { PageHeader } from './PageHeader'
import { useTranslation } from '@/lib/i18nContext'

type Account = { id: string; email: string; displayName?: string | null; provider: string; status?: string }
type DriveFile = {
  id: string
  name: string
  mimeType: string
  size?: string | null
  modifiedTime?: string | null
  webViewLink?: string | null
  shared?: boolean | null
  capabilities?: { canRename?: boolean | null; canTrash?: boolean | null } | null
}
type Page = { files: DriveFile[]; nextPageToken: string | null }
const folderMime = 'application/vnd.google-apps.folder'
const emptyPage: Page = { files: [], nextPageToken: null }

export function GoogleDriveExplorer() {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState<Page>(emptyPage)
  const [parentId, setParentId] = useState<string | undefined>('root')
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: t('My Drive') }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameItem, setRenameItem] = useState<DriveFile | null>(null)
  const [renameName, setRenameName] = useState('')

  useEffect(() => {
    apiFetch<{ accounts: Account[] }>('/connected-accounts')
      .then((data) => {
        const googleAccounts = (data.accounts ?? []).filter((a) => a.provider === 'google_drive' && a.status === 'connected')
        setAccounts(googleAccounts)
        if (googleAccounts.length > 0) setActiveAccountId((current) => current ?? googleAccounts[0].id)
      })
      .catch(() => setAccounts([]))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  async function loadPage(pageToken?: string) {
    if (!activeAccountId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced) params.set('q', searchDebounced)
      else if (parentId) params.set('parentId', parentId)
      if (pageToken) params.set('pageToken', pageToken)
      const data = await apiFetch<Page>(`/google-files/${activeAccountId}?${params.toString()}`)
      setCurrentPage((prev) => pageToken
        ? { files: [...prev.files, ...(data.files ?? [])], nextPageToken: data.nextPageToken ?? null }
        : { files: data.files ?? [], nextPageToken: data.nextPageToken ?? null })
    } catch {
      setError(t('Failed to load this Drive. Check the connection and try again.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPage() }, [activeAccountId, parentId, searchDebounced])

  async function handleRename() {
    if (!activeAccountId || !renameItem || !renameName.trim()) return
    try {
      await apiFetch(`/google-files/${activeAccountId}/${renameItem.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameName.trim() }) })
      setCurrentPage((p) => ({ ...p, files: p.files.map((f) => f.id === renameItem.id ? { ...f, name: renameName.trim() } : f) }))
      setRenameOpen(false)
      setRenameItem(null)
    } catch {
      setError(t('Failed to rename the item.'))
    }
  }

  async function handleTrash(item: DriveFile) {
    if (!activeAccountId) return
    if (!confirm(`${t('Move')} "${item.name}" ${t('to the trash?')}`)) return
    try {
      await apiFetch(`/google-files/${activeAccountId}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
      setCurrentPage((p) => ({ ...p, files: p.files.filter((f) => f.id !== item.id) }))
    } catch {
      setError(t('Failed to move to trash.'))
    }
  }

  async function handleNewFolder() {
    if (!activeAccountId || !newFolderName.trim()) return
    try {
      await apiFetch(`/google-files/${activeAccountId}/folders`, { method: 'POST', body: JSON.stringify({ name: newFolderName.trim(), parentId: parentId && parentId !== 'root' ? parentId : undefined }) })
      setNewFolderOpen(false)
      setNewFolderName('')
      await loadPage()
    } catch {
      setError(t('Failed to create the folder.'))
    }
  }

  function navToFolder(folder: DriveFile) {
    setParentId(folder.id)
    setPath((p) => [...p, { id: folder.id, name: folder.name }])
    setSearch('')
  }

  function navToPath(index: number) {
    const target = path[index]
    setParentId(target.id === 'root' ? 'root' : target.id)
    setPath((p) => p.slice(0, index + 1))
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t('Google Drive Explorer')} description={t('Browse, search, and manage files across connected accounts.')} />
      <div className="mt-4 space-y-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[200px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              value={activeAccountId ?? ''}
              onChange={(e) => { setActiveAccountId(e.target.value); setParentId('root'); setPath([{ id: 'root', name: t('My Drive') }]); setSearch(''); setSearchDebounced('') }}
            >
              <option value="">{t('Select an account')}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.email}</option>)}
            </select>
            <Input placeholder={t('Search files...')} value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[200px] max-w-md flex-1" />
            <Button variant="outline" onClick={() => setNewFolderOpen(true)} disabled={!activeAccountId}><FolderPlus className="h-4 w-4" />{t('New Folder')}</Button>
            <Button variant="outline" onClick={() => loadPage()} disabled={!activeAccountId}><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /></Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
            {path.map((segment, i) => (
              <span key={segment.id} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <button className={i === path.length - 1 ? 'font-medium' : 'text-slate-500 hover:underline'} onClick={() => navToPath(i)}>{segment.name}</button>
              </span>
            ))}
          </div>
        </Card>

        {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

        {accounts.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-slate-500">{t('No Google Drive account connected.')}</p>
          </Card>
        )}

        {activeAccountId && (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">{t('Name')}</th>
                    <th className="px-4 py-3 text-left font-medium">{t('Size')}</th>
                    <th className="px-4 py-3 text-left font-medium">{t('Modified')}</th>
                    <th className="px-4 py-3 text-right font-medium">{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {currentPage.files.length === 0 && !loading ? (
                    <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-500">{searchDebounced ? t('No results') : t('Empty folder')}</td></tr>
                  ) : currentPage.files.map((file) => (
                    <tr key={file.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="flex min-w-0 items-center gap-3 px-4 py-3">
                        {file.mimeType === folderMime ? <Folder className="h-5 w-5 shrink-0 text-amber-500" /> : <File className="h-5 w-5 shrink-0 text-slate-400" />}
                        {file.mimeType === folderMime ? (
                          <button className="min-w-0 truncate text-left hover:underline" onClick={() => navToFolder(file)}>{file.name}</button>
                        ) : (
                          <div className="min-w-0 truncate">{file.name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{file.size ? formatBytes(file.size) : file.mimeType === folderMime ? '—' : t('Unknown')}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{file.modifiedTime ? formatDate(file.modifiedTime) : '—'}</td>
                      <td className="flex items-center justify-end gap-1 px-4 py-3 text-right">
                        {file.webViewLink && <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Open"><ExternalLink className="h-4 w-4" /></a>}
                        {file.capabilities?.canRename && <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setRenameItem(file); setRenameName(file.name); setRenameOpen(true) }} aria-label={t('Rename')}><Pencil className="h-4 w-4" /></button>}
                        {file.capabilities?.canTrash && <button className="rounded-lg p-2 text-orange-600 hover:bg-orange-50" onClick={() => handleTrash(file)} aria-label="Trash"><Trash2 className="h-4 w-4" /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {currentPage.nextPageToken && (
              <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                <Button onClick={() => loadPage(currentPage.nextPageToken ?? undefined)} disabled={loading} className="w-full">{loading ? t('Loading...') : t('Load more')}</Button>
              </div>
            )}
          </Card>
        )}

        <DummyModal open={newFolderOpen} title={t('New Folder')} description={t('Create folder in current location')} onClose={() => setNewFolderOpen(false)}>
          <div className="space-y-3">
            <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder={t('Folder name')} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNewFolderOpen(false)}>{t('Cancel')}</Button>
              <Button onClick={handleNewFolder}>{t('Create')}</Button>
            </div>
          </div>
        </DummyModal>

        <DummyModal open={renameOpen} title={t('Rename')} description={t('Change file or folder name')} onClose={() => { setRenameOpen(false); setRenameItem(null); setRenameName('') }}>
          <div className="space-y-3">
            <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} placeholder={t('New name')} autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRenameOpen(false); setRenameItem(null); setRenameName('') }}>{t('Cancel')}</Button>
              <Button onClick={handleRename}>{t('Save')}</Button>
            </div>
          </div>
        </DummyModal>
      </div>
    </div>
  )
}
