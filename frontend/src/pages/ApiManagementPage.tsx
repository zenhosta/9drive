import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle, Clipboard, KeyRound, ShieldCheck, Trash2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { PageHeader } from '@/components/drive/PageHeader'
import { API_URL, apiFetch, formatDate } from '@/lib/api'
import { useTranslation } from '@/lib/i18nContext'

type ApiKey = { id: string; name: string; keyPrefix: string; scopes: string[]; status: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string }

const curlExample = `curl -X POST "${API_URL}/api/v1/uploads" \\
  -H "Authorization: Bearer 9d_live_xxx" \\
  -F 'filesMeta=[{"fieldName":"file-0","fileName":"hello.txt","mimeType":"text/plain","sizeBytes":"12"}]' \\
  -F "file-0=@hello.txt;type=text/plain"`

const jsExample = `const form = new FormData()
form.append('filesMeta', JSON.stringify([
  { fieldName: 'file-0', fileName: file.name, mimeType: file.type, sizeBytes: String(file.size) },
]))
form.append('file-0', file)

await fetch('${API_URL}/api/v1/uploads', {
  method: 'POST',
  headers: { Authorization: 'Bearer 9d_live_xxx' },
  body: form,
})`

export function ApiManagementPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  async function load() {
    const data = await apiFetch<{ apiKeys: ApiKey[] }>('/api-keys')
    setApiKeys(data.apiKeys)
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : t('Failed to load API keys')))
  }, [])

  async function createKey(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const data = await apiFetch<{ apiKey: ApiKey; secret: string }>('/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName }) })
      setSecret(data.secret)
      setKeyName('')
      setCreateOpen(false)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('Failed to create API key'))
    } finally {
      setLoading(false)
    }
  }

  async function revokeKey(id: string) {
    await apiFetch(`/api-keys/${id}`, { method: 'DELETE' })
    await load()
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value).then(() => setMessage(t('Copied to clipboard.'))).catch(() => setMessage(t('Failed to copy.')))
  }

  const activeKeys = apiKeys.filter((apiKey) => apiKey.status === 'active').length
  const usedKeys = apiKeys.filter((apiKey) => apiKey.lastUsedAt).length

  return (
    <>
      <PageHeader title={t('API Management')} description={t('Create API keys, copy examples, and upload files from external apps.')} actions={<Button className="col-span-2 w-full sm:w-auto" onClick={() => setCreateOpen(true)}><KeyRound className="h-4 w-4" />{t('Create API Key')}</Button>} />
      {message ? <p className="mt-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      {secret ? <Card className="mt-5 min-w-0 overflow-hidden border-blue-200 bg-blue-50 p-0"><div className="grid min-w-0 gap-4 p-4 sm:p-5"><div className="flex min-w-0 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white"><ShieldCheck className="h-5 w-5" /></div><div className="min-w-0"><p className="font-extrabold text-blue-950">{t('Copy your API key now')}</p><p className="mt-1 text-sm text-blue-700">{t('This secret is shown once. Store it securely before closing this page.')}</p></div></div><div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]"><code className="block min-w-0 max-w-full overflow-x-auto rounded-xl bg-white p-3 text-xs font-semibold text-slate-950 sm:text-sm">{secret}</code><Button className="w-full lg:w-auto" type="button" onClick={() => copy(secret)}><Clipboard className="h-4 w-4" />{t('Copy key')}</Button></div></div></Card> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><KeyRound className="h-5 w-5 text-blue-600" /><p className="mt-3 text-2xl font-extrabold">{activeKeys}</p><p className="text-sm text-slate-500">{t('Active keys')}</p></Card>
        <Card className="p-4"><CheckCircle className="h-5 w-5 text-emerald-600" /><p className="mt-3 text-2xl font-extrabold">{usedKeys}</p><p className="text-sm text-slate-500">{t('Used keys')}</p></Card>
        <Card className="p-4"><UploadCloud className="h-5 w-5 text-blue-600" /><p className="mt-3 text-2xl font-extrabold">1</p><p className="text-sm text-slate-500">{t('Upload endpoint')}</p></Card>
      </div>

      <div className="mt-6 grid gap-6">
        <Card className="min-w-0 p-4 sm:p-5">
          <div><h2 className="text-lg font-extrabold">{t('API Keys')}</h2><p className="mt-1 text-sm text-slate-500">{t('Keys can only upload files. Raw secrets are never stored.')}</p></div>
          <div className="mt-4 grid gap-3">
            {apiKeys.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center sm:p-6"><KeyRound className="mx-auto h-8 w-8 text-blue-600" /><p className="mt-3 font-extrabold">{t('No API keys yet')}</p><p className="mt-1 text-sm text-slate-500">{t('Create one key, copy it once, then use the docs below.')}</p><Button className="mt-4 w-full sm:w-auto" onClick={() => setCreateOpen(true)}>{t('Create API Key')}</Button></div> : apiKeys.map((apiKey) => <div key={apiKey.id} className="grid min-w-0 gap-4 rounded-2xl bg-slate-50 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><p className="min-w-0 break-words font-semibold text-slate-950">{apiKey.name}</p><span className={apiKey.status === 'active' ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700' : 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600'}>{apiKey.status}</span></div><div className="mt-2 grid min-w-0 gap-1 text-sm text-slate-500 sm:grid-cols-2"><p className="min-w-0 truncate"><span className="font-semibold text-slate-700">{t('Prefix:')}</span> {apiKey.keyPrefix}...</p><p className="min-w-0 break-words"><span className="font-semibold text-slate-700">{t('Created:')}</span> {formatDate(apiKey.createdAt)}</p><p className="min-w-0 break-words"><span className="font-semibold text-slate-700">{t('Last used:')}</span> {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : t('Never')}</p><p className="min-w-0 break-words"><span className="font-semibold text-slate-700">{t('Scope:')}</span> {apiKey.scopes.join(', ')}</p></div></div>
              <Button className="w-full lg:w-auto" variant="danger" onClick={() => revokeKey(apiKey.id)} disabled={apiKey.status === 'revoked'}><Trash2 className="h-4 w-4" />{t('Revoke')}</Button>
            </div>)}
          </div>
        </Card>

        <Card className="min-w-0 p-4 sm:p-5">
          <div><h2 className="text-lg font-extrabold">{t('Upload API Docs')}</h2><p className="mt-1 text-sm text-slate-500">{t('Multipart upload uses the same storage routing as dashboard uploads.')}</p></div>
          <div className="mt-4 grid gap-4 text-sm text-slate-600">
            <div className="min-w-0"><div className="mb-2 flex items-center justify-between gap-3"><p className="font-bold text-slate-950">{t('Endpoint')}</p><Button variant="outline" size="sm" onClick={() => copy(`${API_URL}/api/v1/uploads`)}><Clipboard className="h-4 w-4" />{t('Copy')}</Button></div><code className="block min-w-0 max-w-full overflow-x-auto rounded-xl bg-slate-100 p-3 text-xs text-slate-950 sm:text-sm">POST {API_URL}/api/v1/uploads</code></div>
            <div className="min-w-0"><p className="font-bold text-slate-950">{t('Auth Header')}</p><code className="mt-2 block min-w-0 max-w-full overflow-x-auto rounded-xl bg-slate-100 p-3 text-xs text-slate-950 sm:text-sm">Authorization: Bearer 9d_live_xxx</code></div>
            <div className="min-w-0"><div className="mb-2 flex items-center justify-between gap-3"><p className="font-bold text-slate-950">{t('cURL')}</p><Button variant="outline" size="sm" onClick={() => copy(curlExample)}><Clipboard className="h-4 w-4" />{t('Copy')}</Button></div><pre className="max-h-72 max-w-full overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-white">{curlExample}</pre></div>
            <div className="min-w-0"><div className="mb-2 flex items-center justify-between gap-3"><p className="font-bold text-slate-950">{t('JavaScript')}</p><Button variant="outline" size="sm" onClick={() => copy(jsExample)}><Clipboard className="h-4 w-4" />{t('Copy')}</Button></div><pre className="max-h-72 max-w-full overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-white">{jsExample}</pre></div>
          </div>
        </Card>
      </div>

      <DummyModal open={createOpen} title={t('Create API Key')} description={t('API keys can upload files using the public API.')} onClose={() => setCreateOpen(false)}>
        <form className="grid gap-4" onSubmit={createKey}>
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder={t('Key name')} value={keyName} onChange={(event) => setKeyName(event.target.value)} required />
          <div className="grid gap-3 sm:flex sm:justify-end"><Button variant="outline" type="button" onClick={() => setCreateOpen(false)} disabled={loading}>{t('Cancel')}</Button><Button type="submit" disabled={loading}>{loading ? t('Creating...') : t('Create Key')}</Button></div>
        </form>
      </DummyModal>
    </>
  )
}
