import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPlan, type PlanAccount, type PlanFile } from './rebalance-plan.js'

const GB = 1024n ** 3n
const acct = (id: string, total: bigint | null, used: bigint): PlanAccount => ({ id, email: `${id}@x.test`, totalBytes: total, usedBytes: used, availableBytes: total === null ? null : total - used })
const file = (id: string, gb: bigint, isNative = false): PlanFile => ({ id, name: id, sizeBytes: gb * GB, isNative })

test('frees requested bytes, largest first, onto the emptiest target', () => {
  const plan = buildPlan({
    source: acct('src', 15n * GB, 15n * GB),
    targets: [acct('a', 15n * GB, 10n * GB), acct('b', 15n * GB, 1n * GB)],
    files: [file('f1', 5n), file('f2', 3n), file('f3', 1n)],
    freeUpBytes: 6n * GB,
  })
  assert.equal(plan.items.length, 2)
  assert.deepEqual(plan.items.map((i) => i.fileId), ['f1', 'f2'])
  assert.ok(plan.items.every((i) => i.targetAccountId === 'b'))
  assert.equal(plan.plannedBytes, 8n * GB)
  assert.equal(plan.shortfallBytes, 0n)
  const [src, , b] = plan.accounts
  assert.equal(src.usedAfter, 7n * GB)
  assert.equal(b.usedAfter, 9n * GB)
  // bytes are conserved across accounts
  const before = plan.accounts.reduce((s, a) => s + a.usedBefore, 0n)
  const after = plan.accounts.reduce((s, a) => s + a.usedAfter, 0n)
  assert.equal(before, after)
})

test('respects the 90% ceiling and reports a shortfall', () => {
  const plan = buildPlan({
    source: acct('src', 15n * GB, 15n * GB),
    targets: [acct('a', 15n * GB, 12n * GB)], // ceiling 13.5 GB => ~1.5 GB minus 100 MB margin
    files: [file('big', 5n), file('small', 1n)],
    freeUpBytes: 5n * GB,
  })
  assert.deepEqual(plan.items.map((i) => i.fileId), ['small'])
  assert.equal(plan.unplaced.length, 1)
  assert.ok(plan.shortfallBytes > 0n)
})

test('targetUsedPercent computes the need; native files are excluded', () => {
  const plan = buildPlan({
    source: acct('src', 100n * GB, 95n * GB),
    targets: [acct('a', 100n * GB, 0n)],
    files: [file('doc', 0n, true), file('v', 30n)],
    targetUsedPercent: 70,
  })
  assert.equal(plan.needBytes, 25n * GB)
  assert.equal(plan.nativeExcluded, 1)
  assert.deepEqual(plan.items.map((i) => i.fileId), ['v'])
})

test('unlimited targets accept anything; nothing needed gives an empty plan', () => {
  const plan = buildPlan({ source: acct('src', 10n * GB, 9n * GB), targets: [acct('s3', null, 0n)], files: [file('f', 8n)], freeUpBytes: 8n * GB })
  assert.equal(plan.items[0].targetAccountId, 's3')
  const empty = buildPlan({ source: acct('src', 10n * GB, 1n * GB), targets: [acct('a', 10n * GB, 0n)], files: [file('f', 1n)], targetUsedPercent: 70 })
  assert.equal(empty.items.length, 0)
})
