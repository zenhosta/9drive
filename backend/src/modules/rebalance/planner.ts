export type BalanceAccount = { id: string; label: string; usedBytes: string; freeBytes: string }
export type Candidate = {
  sourceAccountId: string; sourceFileId: string; name: string; mimeType: string;
  sizeBytes: string; md5: string; modifiedTime: string;
}
export type Move = Candidate & { id: string; targetAccountId: string; status: 'pending' | 'copying' | 'completed' | 'failed'; targetFileId?: string; originalDeleted?: boolean; error?: string }

// Greedily reduce the variance of active bytes. Copies in trash still consume real
// quota, so moving out never increases a destination's available upload capacity.
export function planBalance(accounts: BalanceAccount[], candidates: Candidate[], maxMoves = 100) {
  const used = new Map(accounts.map(a => [a.id, BigInt(a.usedBytes)]))
  const free = new Map(accounts.map(a => [a.id, BigInt(a.freeBytes)]))
  const moves: Omit<Move, 'id'>[] = []
  const sorted = [...candidates].sort((a, b) => BigInt(a.sizeBytes) > BigInt(b.sizeBytes) ? -1 : BigInt(a.sizeBytes) < BigInt(b.sizeBytes) ? 1 : a.sourceFileId.localeCompare(b.sourceFileId))
  for (const file of sorted) {
    const bytes = BigInt(file.sizeBytes)
    if (bytes <= 0n || !used.has(file.sourceAccountId) || used.get(file.sourceAccountId)! < bytes) continue
    let best: string | undefined
    let gain = 0n
    for (const target of accounts) {
      if (target.id === file.sourceAccountId || free.get(target.id)! < bytes) continue
      const difference = used.get(file.sourceAccountId)! - used.get(target.id)!
      const improvement = 2n * bytes * (difference - bytes)
      if (improvement > gain) { gain = improvement; best = target.id }
    }
    if (!best) continue
    moves.push({ ...file, targetAccountId: best, status: 'pending' })
    used.set(file.sourceAccountId, used.get(file.sourceAccountId)! - bytes)
    used.set(best, used.get(best)! + bytes)
    free.set(best, free.get(best)! - bytes)
    if (moves.length >= maxMoves) break
  }
  return { moves, projected: accounts.map(a => ({ ...a, usedBytes: used.get(a.id)!.toString() })) }
}

export function verifyCopy(source: { sizeBytes: string; md5: string }, target: { size?: string | null; md5Checksum?: string | null; trashed?: boolean | null }) {
  if (target.trashed || !target.md5Checksum || BigInt(target.size ?? '-1') !== BigInt(source.sizeBytes) || target.md5Checksum !== source.md5) {
    throw new Error('A cópia não passou na verificação de tamanho e checksum. O original foi preservado.')
  }
}

// Preserve reviewed destinations and order; exclusions apply to this batch only.
export function selectBalanceMoves(accounts: BalanceAccount[], moves: Move[], selectedIds: string[]) {
  const selected = new Set(selectedIds)
  if (!selected.size || selected.size !== selectedIds.length || selectedIds.some(id => !moves.some(m => m.id === id))) {
    const error = new Error('Selecione pelo menos um arquivo válido da prévia, sem repetir arquivos.')
    error.name = 'BalanceError'
    throw error
  }
  const approved = moves.filter(m => selected.has(m.id))
  const used = new Map(accounts.map(a => [a.id, BigInt(a.usedBytes)]))
  for (const move of approved) {
    const size = BigInt(move.sizeBytes)
    used.set(move.sourceAccountId, used.get(move.sourceAccountId)! - size)
    used.set(move.targetAccountId, used.get(move.targetAccountId)! + size)
  }
  return { moves: approved, projected: accounts.map(a => ({ ...a, usedBytes: used.get(a.id)!.toString() })) }
}