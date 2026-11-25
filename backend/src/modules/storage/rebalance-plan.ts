import { DAILY_UPLOAD_LIMIT_BYTES, MAX_TARGET_USED_PERCENT, TARGET_SAFETY_MARGIN_BYTES } from '../jobs/move-logic.js'

export type PlanAccount = { id: string; email: string; totalBytes: bigint | null; usedBytes: bigint; availableBytes: bigint | null }
export type PlanFile = { id: string; name: string; sizeBytes: bigint; isNative: boolean }
export type PlanInput = {
  source: PlanAccount
  targets: PlanAccount[]
  files: PlanFile[]
  freeUpBytes?: bigint
  targetUsedPercent?: number
}
export type PlanItem = { fileId: string; name: string; sizeBytes: bigint; targetAccountId: string }
export type PlanAccountDelta = { id: string; email: string; totalBytes: bigint | null; usedBefore: bigint; usedAfter: bigint; availableBefore: bigint | null; availableAfter: bigint | null; filesIn: number; filesOut: number }
export type Plan = {
  needBytes: bigint
  plannedBytes: bigint
  shortfallBytes: bigint
  items: PlanItem[]
  unplaced: Array<{ fileId: string; name: string; sizeBytes: bigint }>
  nativeExcluded: number
  accounts: PlanAccountDelta[]
  warnings: string[]
}

function pct(used: bigint, total: bigint) {
  return Number((used * 10000n) / total) / 100
}

/** How many bytes a target can still take while keeping the safety margin and the max-used-percent ceiling. */
export function targetCapacity(t: PlanAccount): bigint | null {
  if (t.availableBytes === null) return null // unlimited
  let room = t.availableBytes - TARGET_SAFETY_MARGIN_BYTES
  if (t.totalBytes !== null && t.totalBytes > 0n) {
    const ceiling = (t.totalBytes * BigInt(MAX_TARGET_USED_PERCENT)) / 100n - t.usedBytes
    if (ceiling < room) room = ceiling
  }
  return room > 0n ? room : 0n
}

export function buildPlan(input: PlanInput): Plan {
  const { source, targets, files } = input
  const warnings: string[] = []
  let need = 0n
  if (input.freeUpBytes !== undefined) need = input.freeUpBytes
  else if (input.targetUsedPercent !== undefined && source.totalBytes && source.totalBytes > 0n) {
    const desiredUsed = (source.totalBytes * BigInt(Math.round(input.targetUsedPercent * 100))) / 10000n
    need = source.usedBytes > desiredUsed ? source.usedBytes - desiredUsed : 0n
  }
  if (need < 0n) need = 0n

  // Native Google files barely count toward quota, so moving them would not free the space asked for.
  const nativeExcluded = files.filter((f) => f.isNative).length
  if (nativeExcluded > 0) warnings.push(`${nativeExcluded} native Google file(s) (Docs/Sheets/Slides) were left out: they use little or no quota, so moving them would free almost nothing. You can still move them manually.`)

  const candidates = files.filter((f) => !f.isNative && f.sizeBytes > 0n).sort((a, b) => (a.sizeBytes === b.sizeBytes ? 0 : a.sizeBytes > b.sizeBytes ? -1 : 1))
  const room = new Map<string, bigint | null>(targets.map((t) => [t.id, targetCapacity(t)]))
  const incomingBytes = new Map<string, bigint>(targets.map((t) => [t.id, 0n]))
  const items: PlanItem[] = []
  const unplaced: Plan['unplaced'] = []
  let planned = 0n

  for (const file of candidates) {
    if (planned >= need) break
    // Pick the target with the most remaining room that fits this file (unlimited wins).
    let best: PlanAccount | null = null
    let bestRoom: bigint | null = -1n
    for (const t of targets) {
      const r = room.get(t.id) ?? null
      if (r !== null && r < file.sizeBytes) continue
      if (best === null || r === null || (bestRoom !== null && r > bestRoom)) {
        best = t
        bestRoom = r
        if (r === null) break
      }
    }
    if (!best) {
      unplaced.push({ fileId: file.id, name: file.name, sizeBytes: file.sizeBytes })
      continue
    }
    items.push({ fileId: file.id, name: file.name, sizeBytes: file.sizeBytes, targetAccountId: best.id })
    planned += file.sizeBytes
    const r = room.get(best.id) ?? null
    if (r !== null) room.set(best.id, r - file.sizeBytes)
    incomingBytes.set(best.id, (incomingBytes.get(best.id) ?? 0n) + file.sizeBytes)
  }

  const shortfall = need > planned ? need - planned : 0n
  if (shortfall > 0n) warnings.push('The selected drives cannot absorb everything requested. The plan frees as much as it safely can.')
  if (unplaced.length > 0) warnings.push(`${unplaced.length} file(s) did not fit on any target drive within the safety limits.`)
  for (const t of targets) {
    const inBytes = incomingBytes.get(t.id) ?? 0n
    if (inBytes > DAILY_UPLOAD_LIMIT_BYTES) warnings.push(`${t.email} would receive more than ~750 GB, above Google's daily upload limit. The job will hit rate limits; run it in several batches.`)
  }
  warnings.push('Moved files get a new Drive file ID on the target. 9Drive keeps their name, virtual folder, share links and preview links. The permanent delete on the source frees space only once the copy is verified.')

  const filesOutBySource = items.length
  const accounts: PlanAccountDelta[] = [
    { id: source.id, email: source.email, totalBytes: source.totalBytes, usedBefore: source.usedBytes, usedAfter: source.usedBytes - planned, availableBefore: source.availableBytes, availableAfter: source.availableBytes === null ? null : source.availableBytes + planned, filesIn: 0, filesOut: filesOutBySource },
    ...targets.map((t) => {
      const inBytes = incomingBytes.get(t.id) ?? 0n
      return { id: t.id, email: t.email, totalBytes: t.totalBytes, usedBefore: t.usedBytes, usedAfter: t.usedBytes + inBytes, availableBefore: t.availableBytes, availableAfter: t.availableBytes === null ? null : t.availableBytes - inBytes, filesIn: items.filter((i) => i.targetAccountId === t.id).length, filesOut: 0 }
    }),
  ]

  const srcAfter = accounts[0]
  if (srcAfter.totalBytes && srcAfter.totalBytes > 0n && pct(srcAfter.usedAfter, srcAfter.totalBytes) > MAX_TARGET_USED_PERCENT) warnings.push('The source drive will still be above 90% used after this plan.')

  return { needBytes: need, plannedBytes: planned, shortfallBytes: shortfall, items, unplaced, nativeExcluded, accounts, warnings }
}
