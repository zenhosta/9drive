import { useEffect, useState } from 'react'
import { ArrowRight, Scale, RefreshCw } from 'lucide-react'
import { apiFetch, formatBytes } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Account = { id: string; label: string; usedBytes: string; freeBytes: string }
type Move = { id: string; name: string; sizeBytes: string; sourceAccountId: string; targetAccountId: string; status: string; originalDeleted?: boolean; error?: string }
type Job = { id: string; status: string; plan: { deleteOriginals?: boolean; scope: 'managed' | 'all'; accounts: Account[]; projected: Account[]; moves: Move[]; scanned: number; skipped: number; limited: boolean } }
const labels: Record<string, string> = { draft: 'Prévia pronta', running: 'Transferindo', paused: 'Pausado', failed: 'Interrompido', completed: 'Concluído', cancelled: 'Encerrado', pending: 'Aguardando', copying: 'Copiando e verificando' }

export function StorageBalancer({ onComplete }: { onComplete: () => void }) {
  const [scope, setScope] = useState<'managed' | 'all'>('managed')
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedMoveIds, setSelectedMoveIds] = useState<string[]>([])
  const [deleteOriginals, setDeleteOriginals] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadJob() {
    const res = await apiFetch('/rebalance')
    if (res.ok) { const data = await res.json(); setJob(data.job) } else { setJob(null) }
  }

  useEffect(() => { loadJob() }, [])

  async function handlePreview() {
    setPreviewLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/rebalance/preview', { method: 'POST', body: JSON.stringify({ scope }) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.message ?? 'Erro na prévia') }
      const data = await res.json()
      setJob(data.job)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao gerar prévia') }
    finally { setPreviewLoading(false) }
  }

  async function handleStart() {
    if (!job) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/rebalance/${job.id}/start`, { method: 'POST', body: JSON.stringify({ selectedMoveIds, deleteOriginals }) })
      if (!res.ok) { const data = await res.json(); throw new Error(data.message ?? 'Erro ao iniciar') }
      const data = await res.json()
      setJob(data.job)
      poll()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao iniciar redistribuição') }
    finally { setLoading(false) }
  }

  async function handlePause() {
    if (!job) return
    try {
      const res = await apiFetch(`/rebalance/${job.id}/pause`, { method: 'POST' })
      if (res.ok) { const data = await res.json(); setJob(data.job) }
    } catch { setError('Erro ao pausar') }
  }

  async function handleEnd() {
    if (!job) return
    try {
      const res = await apiFetch(`/rebalance/${job.id}/end`, { method: 'POST' })
      if (res.ok) { const data = await res.json(); setJob(data.job) }
    } catch { setError('Erro ao encerrar') }
  }

  function poll() {
    if (!job || job.status !== 'running') return
    const interval = setInterval(async () => {
      const res = await apiFetch('/rebalance')
      if (res.ok) {
        const data = await res.json()
        if (data.job) {
          setJob(data.job)
          if (data.job.status !== 'running') { clearInterval(interval); onComplete() }
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }

  useEffect(() => { if (job?.status === 'running') poll() }, [job?.status])

  function progress() {
    if (!job?.plan) return { done: 0, total: 0 }
    const moves = job.plan.moves
    const done = moves.filter(m => m.status === 'completed').length
    return { done, total: moves.length }
  }

  if (!job) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2"><Scale className="h-5 w-5" /><h3 className="text-lg font-bold">Balanceamento de Armazenamento</h3></div>
        <p className="text-slate-500">Conecte pelo menos duas contas Google Drive para redistribuir arquivos e equilibrar o uso de cota.</p>
        <div className="flex gap-2">
          <label className="flex items-center gap-2"><input type="radio" name="scope" value="managed" checked={scope === 'managed'} onChange={() => setScope('managed')} className="sr-only peer" /><span className="px-3 py-2 rounded-lg border border-slate-300 peer-checked:bg-sky-50 peer-checked:border-sky-500 peer-checked:text-sky-700 dark:border-slate-700 dark:peer-checked:bg-sky-900/30 dark:peer-checked:border-sky-500">Gerenciado (app 9drive)</span></label>
          <label className="flex items-center gap-2"><input type="radio" name="scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} className="sr-only peer" /><span className="px-3 py-2 rounded-lg border border-slate-300 peer-checked:bg-sky-50 peer-checked:border-sky-500 peer-checked:text-sky-700 dark:border-slate-700 dark:peer-checked:bg-sky-900/30 dark:peer-checked:border-sky-500">Tudo (Meu Drive completo)</span></label>
        </div>
        <Button onClick={handlePreview} disabled={previewLoading} className="w-full">{previewLoading ? 'Analisando...' : 'Gerar Prévia'}</Button>
      </Card>
    )
  }

  const statusLabel = labels[job.status] || job.status
  const { done, total } = progress()

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Scale className="h-5 w-5" /><h3 className="text-lg font-bold">Balanceamento de Armazenamento</h3></div>
        <span className="px-2 py-1 text-xs rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">{statusLabel}</span>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-sm">{error}</div>}

      {job.status === 'draft' && job.plan && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {job.plan.accounts.map(acc => {
              const proj = job.plan!.projected.find(p => p.id === acc.id)
              return (
                <div key={acc.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                  <p className="text-sm font-medium truncate">{acc.label}</p>
                  <div className="mt-1 h-2 bg-slate-200 rounded-full dark:bg-slate-700 overflow-hidden">
                    <div className="h-full bg-sky-500 transition-all" style={{ width: `${acc.freeBytes === '0' ? 100 : Math.min(100, (Number(acc.usedBytes) / (Number(acc.usedBytes) + Number(acc.freeBytes))) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Usado: {formatBytes(acc.usedBytes)}</p>
                  {proj && <p className="text-xs text-sky-600 dark:text-sky-400">Projetado: {formatBytes(proj.usedBytes)}</p>}
                </div>
              )
            })}
          </div>

          <div className="max-h-60 overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                <tr><th className="px-3 py-2 text-left w-8"><input type="checkbox" onChange={e => { if (e.target.checked) setSelectedMoveIds(job.plan!.moves.map(m => m.id)); else setSelectedMoveIds([]) }} /></th><th className="px-3 py-2 text-left">Arquivo</th><th className="px-3 py-2 text-left">Tamanho</th><th className="px-3 py-2 text-left">De</th><th className="px-3 py-2 text-left">Para</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {job.plan.moves.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2"><input type="checkbox" checked={selectedMoveIds.includes(m.id)} onChange={e => { if (e.target.checked) setSelectedMoveIds([...selectedMoveIds, m.id]); else setSelectedMoveIds(selectedMoveIds.filter(id => id !== m.id)) }} /></td>
                    <td className="px-3 py-2 truncate max-w-xs">{m.name}</td>
                    <td className="px-3 py-2">{formatBytes(m.sizeBytes)}</td>
                    <td className="px-3 py-2 text-xs">{job.plan.accounts.find(a => a.id === m.sourceAccountId)?.label}</td>
                    <td className="px-3 py-2 text-xs">{job.plan.accounts.find(a => a.id === m.targetAccountId)?.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deleteOriginals} onChange={e => setDeleteOriginals(e.target.checked)} /> Excluir originais após cópia verificada</label>
            <span className="text-xs text-slate-500">{selectedMoveIds.length}/{total} arquivos selecionados</span>
          </div>

          <Button onClick={handleStart} disabled={loading || selectedMoveIds.length === 0} className="w-full">{loading ? 'Iniciando...' : 'Iniciar Redistribuição'}</Button>
        </div>
      )}

      {['running', 'paused', 'failed'].includes(job.status) && job.plan && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <span>Progresso: <strong>{done}/{total}</strong></span>
            <div className="flex-1 h-2 bg-slate-200 rounded-full dark:bg-slate-700 overflow-hidden"><div className="h-full bg-sky-500 transition-all" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} /></div>
          </div>
          <div className="max-h-60 overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                <tr><th className="px-3 py-2 text-left">Arquivo</th><th className="px-3 py-2 text-left">Tamanho</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Erro</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {job.plan.moves.map(m => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 truncate max-w-xs">{m.name}</td>
                    <td className="px-3 py-2">{formatBytes(m.sizeBytes)}</td>
                    <td className="px-3 py-2 capitalize">{m.status.replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-red-600 dark:text-red-400 text-xs">{m.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            {job.status === 'running' && <Button variant="outline" onClick={handlePause}>Pausar</Button>}
            {job.status === 'paused' && <Button onClick={handleStart}>Retomar</Button>}
            {['paused', 'failed'].includes(job.status) && <Button variant="destructive" onClick={handleEnd}>Encerrar</Button>}
            {job.status === 'completed' && <Button variant="outline" onClick={onComplete}>Voltar</Button>}
          </div>
        </div>
      )}

      {job.status === 'completed' && (
        <div className="text-center py-4">
          <Scale className="h-12 w-12 text-green-500 mx-auto" />
          <h4 className="mt-2 font-bold">Redistribuição concluída</h4>
          <p className="text-sm text-slate-500">{total} arquivos movidos</p>
          <Button variant="outline" className="mt-4" onClick={onComplete}>Nova redistribuição</Button>
        </div>
      )}

      {job.status === 'cancelled' && (
        <div className="text-center py-4">
          <p className="text-slate-500">Redistribuição encerrada</p>
          <Button variant="outline" className="mt-4" onClick={onComplete}>Nova redistribuição</Button>
        </div>
      )}
    </Card>
  )
}