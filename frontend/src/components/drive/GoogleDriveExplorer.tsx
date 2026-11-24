import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, File, Folder, FolderPlus, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { apiFetch, formatBytes, formatDate } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { DummyModal } from './DummyModal'
import { PageHeader } from './PageHeader'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'

type Account = { id: string; email: string; displayName?: string | null; provider: string }
type DriveFile = { id: string; name: string; mimeType: string; sizeBytes: string | null; modifiedAt: string | null; webViewLink: string | null; shared: boolean; canRename: boolean; canTrash: boolean }
type Page = { files: DriveFile[]; nextPageToken: string | null; incomplete: boolean; error?: string }
type Item = DriveFile & { account: Account }
const folderMime = 'application/vnd.google-apps.folder'
const emptyPage: Page = { files: [], nextPageToken: null, incomplete: false }

export function GoogleDriveExplorer() {
  const { setTitle } = useDriveLayoutActions()
  const [searchParams] = useSearchParams()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState<Page>(emptyPage)
  const [parentId, setParentId] = useState<string | undefined>('root')
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: 'Meu Drive' }])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParent, setNewFolderParent] = useState<string | undefined>('root')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameItem, setRenameItem] = useState<Item | null>(null)
  const [renameName, setRenameName] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadParent, setUploadParent] = useState<string | undefined>('root')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTitle('Google Drive Explorer') }, [setTitle])

  useEffect(() => {
    const load = async () => {
      const res = await apiFetch('/connected-accounts')
      if (res.ok) {
        const data = await res.json()
        const googleAccounts = (data.accounts ?? []).filter((a: Account) => a.provider === 'google_drive' && a.status === 'connected')
        setAccounts(googleAccounts)
        if (googleAccounts.length > 0 && !activeAccountId) setActiveAccountId(googleAccounts[0].id)
      }
    }
    load()
  }, [activeAccountId])

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!activeAccountId) return
    const load = async () => {
      setLoading(true)
      try {
        const q = searchDebounced ? undefined : parentId
        const res = await apiFetch(`/google-files/${activeAccountId}${q ? `?parentId=${q}` : searchDebounced ? `?q=${encodeURIComponent(searchDebounced)}` : ''}`)
        if (res.ok) {
          const data = await res.json()
          setCurrentPage({ files: data.files ?? [], nextPageToken: data.nextPageToken ?? null, incomplete: false })
        } else { setCurrentPage({ ...emptyPage, error: 'Falha ao carregar' }) }
      } catch { setCurrentPage({ ...emptyPage, error: 'Erro de conexão' }) }
      finally { setLoading(false) }
    }
    load()
  }, [activeAccountId, parentId, searchDebounced])

  async function handleRename() {
    if (!renameItem || !renameName.trim()) return
    try {
      await apiFetch(`/google-files/${activeAccountId}/${renameItem.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameName.trim() }) })
      setRenameOpen(false)
      setCurrentPage(p => ({ ...p, files: p.files.map(f => f.id === renameItem.id ? { ...f, name: renameName.trim() } : f) }))
    } catch { alert('Erro ao renomear') }
  }

  async function handleTrash(item: Item) {
    if (!confirm(`Mover "${item.name}" para a lixeira?`)) return
    try {
      await apiFetch(`/google-files/${activeAccountId}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
      setCurrentPage(p => ({ ...p, files: p.files.filter(f => f.id !== item.id) }))
    } catch { alert('Erro ao mover para lixeira') }
  }

  async function handleNewFolder() {
    if (!newFolderName.trim()) return
    try {
      await apiFetch(`/google-files/${activeAccountId}/folders`, { method: 'POST', body: JSON.stringify({ name: newFolderName.trim(), parentId: newFolderParent }) })
      setNewFolderOpen(false)
      setNewFolderName('')
      setNewFolderParent(parentId)
      if (parentId === newFolderParent) {
        const res = await apiFetch(`/google-files/${activeAccountId}${parentId ? `?parentId=${parentId}` : ''}`)
        if (res.ok) { const data = await res.json(); setCurrentPage({ files: data.files ?? [], nextPageToken: data.nextPageToken ?? null, incomplete: false }) }
      }
    } catch { alert('Erro ao criar pasta') }
  }

  async function handleUpload() {
    if (!uploadFile) return
    const form = new FormData()
    form.append('file', uploadFile)
    if (uploadParent) form.append('parentId', uploadParent)
    try {
      await apiFetch(`/uploads/google/${activeAccountId}`, { method: 'POST', body: form, headers: {} })
      setUploadOpen(false)
      setUploadFile(null)
      setUploadParent(parentId)
      const res = await apiFetch(`/google-files/${activeAccountId}${parentId ? `?parentId=${parentId}` : ''}`)
      if (res.ok) { const data = await res.json(); setCurrentPage({ files: data.files ?? [], nextPageToken: data.nextPageToken ?? null, incomplete: false }) }
    } catch { alert('Erro no upload') }
  }

  function navToFolder(folder: Item) {
    setParentId(folder.id)
    setPath(p => [...p, { id: folder.id, name: folder.name }])
  }

  function navToPath(index: number) {
    const target = path[index]
    setParentId(target.id === 'root' ? undefined : target.id)
    setPath(p => p.slice(0, index + 1))
  }

  function loadMore() {
    if (!currentPage.nextPageToken || loading) return
    const load = async () => {
      setLoading(true)
      try {
        const res = await apiFetch(`/google-files/${activeAccountId}${parentId ? `?parentId=${parentId}` : searchDebounced ? `?q=${encodeURIComponent(searchDebounced)}` : ''}&pageToken=${currentPage.nextPageToken}`)
        if (res.ok) {
          const data = await res.json()
          setCurrentPage(p => ({ ...p, files: [...p.files, ...(data.files ?? [])], nextPageToken: data.nextPageToken ?? null }))
        }
      } finally { setLoading(false) }
    }
    load()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Google Drive Explorer" description="Navegue, busque e gerencie arquivos nas contas conectadas" />
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" value={activeAccountId ?? ''} onChange={e => { setActiveAccountId(e.target.value); setParentId('root'); setPath([{ id: 'root', name: 'Meu Drive' }]); setSearch(''); setSearchDebounced('') }}>
              <option value="">Selecione uma conta</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.displayName || a.email}</option>)}
            </select>
            <Input placeholder="Buscar arquivos..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[200px] max-w-md" />
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-400">
            {path.map((segment, i) => (
              <span key={segment.id} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <button className={cn(i === path.length - 1 ? 'font-medium' : 'text-slate-500 hover:underline', 'focus:outline-none')} onClick={() => navToPath(i)}>{segment.name}</button>
              </span>
            ))}
          </div>
        </Card>

        {accounts.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-slate-500">Nenhuma conta Google Drive conectada.</p>
            <Button className="mt-4" onClick={() => window.location.href = '/settings'}>Configurar Conta</Button>
          </Card>
        )}

        {activeAccountId && (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Nome</th>
                    <th className="px-4 py-3 text-left font-medium">Tamanho</th>
                    <th className="px-4 py-3 text-left font-medium">Modificado</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {currentPage.files.length === 0 && !loading ? (
                    <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-500">{searchDebounced ? 'Nenhum resultado' : 'Pasta vazia'}</td></tr>
                  ) : (
                    currentPage.files.map(file => (
                      <tr key={file.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 flex items-center gap-3 min-w-0">
                          {file.mimeType === folderMime ? <Folder className="h-5 w-5 text-amber-500 shrink-0" /> : <File className="h-5 w-5 text-slate-400 shrink-0" />}
                          <div className="min-w-0 truncate">{file.name}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{file.sizeBytes ? formatBytes(file.sizeBytes) : file.mimeType === folderMime ? '—' : 'Desconhecido'}</td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{file.modifiedAt ? formatDate(file.modifiedAt) : '—'}</td>
                        <td className="px-4 py-3 text-right flex items-center justify-end gap-1">
                          {file.webViewLink && <Button variant="ghost" size="icon" asChild><a href={file.webViewLink} target="_blank" rel="noopener"><ExternalLink className="h-4 w-4" /></a></Button>}
                          {file.canRename && <Button variant="ghost" size="icon" onClick={() => { setRenameItem({ ...file, account: accounts.find(a => a.id === activeAccountId)! }); setRenameName(file.name); setRenameOpen(true) }}><Pencil className="h-4 w-4" /></Button>}
                          {file.canTrash && <Button variant="ghost" size="icon" onClick={() => handleTrash({ ...file, account: accounts.find(a => a.id === activeAccountId)! })}><Trash2 className="h-4 w-4" /></Button>}
                          {file.mimeType === folderMime && <Button variant="ghost" size="icon" onClick={() => navToFolder({ ...file, account: accounts.find(a => a.id === activeAccountId)! })}><Folder className="h-4 w-4" /></Button>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {currentPage.nextPageToken && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <Button onClick={loadMore} disabled={loading} className="w-full">{loading ? 'Carregando...' : 'Carregar mais'}</Button>
              </div>
            )}
          </Card>
        )}

        <DummyModal open={newFolderOpen} title="Nova pasta" description="Criar pasta na localização atual" onClose={() => setNewFolderOpen(false)}>
          <div className="space-y-3">
            <Input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Nome da pasta" autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancelar</Button>
              <Button onClick={handleNewFolder}>Criar</Button>
            </div>
          </div>
        </DummyModal>

        <DummyModal open={renameOpen} title="Renomear" description="Alterar nome do arquivo ou pasta" onClose={() => { setRenameOpen(false); setRenameItem(null); setRenameName('') }}>
          <div className="space-y-3">
            <Input value={renameName} onChange={e => setRenameName(e.target.value)} placeholder="Novo nome" autoFocus />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRenameOpen(false); setRenameItem(null); setRenameName('') }}>Cancelar</Button>
              <Button onClick={handleRename}>Salvar</Button>
            </div>
          </div>
        </DummyModal>

        <DummyModal open={uploadOpen} title="Upload de arquivo" description="Enviar arquivo para a pasta atual" onClose={() => { setUploadOpen(false); setUploadFile(null) }}>
          <div className="space-y-3">
            <input type="file" ref={fileInputRef} className="sr-only" id="drive-upload" onChange={e => { if (e.target.files?.[0]) setUploadFile(e.target.files[0]) }} />
            <label htmlFor="drive-upload" className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer dark:border-slate-600">
              <Upload className="h-8 w-8 text-slate-400" />
              <span className="mt-2 text-sm text-slate-500">Clique ou arraste um arquivo</span>
              {uploadFile && <span className="mt-1 text-sm font-medium">{uploadFile.name}</span>}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setUploadOpen(false); setUploadFile(null) }}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={!uploadFile}>Enviar</Button>
            </div>
          </div>
        </DummyModal>
      </div>
      <div className="fixed bottom-4 right-4 z-10 flex gap-2" role="group" aria-label="Ações rápidas">
        <Button variant="outline" size="icon" onClick={() => { setNewFolderParent(parentId); setNewFolderOpen(true) }} aria-label="Nova pasta"><FolderPlus className="h-5 w-5" /></Button>
        <Button variant="outline" size="icon" onClick={() => { setUploadParent(parentId); setUploadOpen(true) }} aria-label="Upload"><Upload className="h-5 w-5" /></Button>
        <Button variant="outline" size="icon" onClick={() => { setSearch(''); setSearchDebounced(''); setParentId('root'); setPath([{ id: 'root', name: 'Meu Drive' }]) }} aria-label="Voltar à raiz"><RefreshCw className="h-5 w-5" /></Button>
      </div>
    </div>
  )
}

function cn(...classes: (string | undefined | null | false)[]) { return classes.filter(Boolean).join(' ') }