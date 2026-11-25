import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ThumbCache } from './thumb-cache.js'

const DAY = 24 * 60 * 60 * 1000
async function setup(maxBytes: number, ttlMs = 7 * DAY) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbtest-'))
  let t = 1_000_000_000
  const clock = { now: () => t, advance: (ms: number) => { t += ms } }
  return { dir, clock, cache: new ThumbCache({ dir, maxBytes, ttlMs, now: clock.now }) }
}
const blob = (n: number) => Buffer.alloc(n, 1)

test('stores and returns a thumbnail', async () => {
  const { cache } = await setup(10_000)
  await cache.put('a'.repeat(40), blob(100), 'image/png')
  const hit = await cache.get('a'.repeat(40))
  assert.equal(hit?.data.length, 100)
  assert.equal(hit?.type, 'image/png')
  assert.equal(await cache.get('b'.repeat(40)), null)
})

test('never grows past the size cap: oldest entries go first, recent ones stay', async () => {
  const { cache, clock } = await setup(1000)
  const keys = ['1', '2', '3', '4', '5'].map((c) => c.repeat(40))
  for (const k of keys) { await cache.put(k, blob(400), 'image/jpeg'); clock.advance(1000) }
  const stats = await cache.stats()
  assert.ok(stats.bytes <= 1000, `size ${stats.bytes}`)
  assert.equal(await cache.get(keys[0]), null) // oldest evicted
  assert.ok(await cache.get(keys[4])) // newest kept
})

test('using an entry keeps it: least recently USED is evicted, not least recently added', async () => {
  const { cache, clock } = await setup(1000)
  const [a, b, c] = ['a', 'b', 'c'].map((x) => x.repeat(40))
  await cache.put(a, blob(400), 'image/jpeg'); clock.advance(1000)
  await cache.put(b, blob(400), 'image/jpeg'); clock.advance(1000)
  assert.ok(await cache.get(a)); clock.advance(1000) // a is now the most recently used
  await cache.put(c, blob(400), 'image/jpeg')
  assert.ok(await cache.get(a))
  assert.equal(await cache.get(b), null)
})

test('entries unused for 7 days are deleted (from disk too)', async () => {
  const { cache, clock, dir } = await setup(10_000)
  const k = 'd'.repeat(40)
  await cache.put(k, blob(100), 'image/jpeg')
  clock.advance(6 * DAY)
  assert.ok(await cache.get(k)) // used on day 6, so the clock restarts
  clock.advance(6 * DAY)
  assert.ok(await cache.get(k))
  clock.advance(8 * DAY)
  await cache.sweep()
  assert.equal(await cache.get(k), null)
  assert.deepEqual((await fs.readdir(dir)).filter((f) => f.startsWith(k)), [])
})

test('a restart keeps existing entries and still enforces limits', async () => {
  const { dir, clock } = await setup(10_000)
  const first = new ThumbCache({ dir, maxBytes: 10_000, ttlMs: 7 * DAY, now: clock.now })
  await first.put('e'.repeat(40), blob(300), 'image/jpeg')
  const second = new ThumbCache({ dir, maxBytes: 500, ttlMs: 7 * DAY, now: clock.now })
  assert.equal((await second.stats()).count, 1)
  await second.put('f'.repeat(40), blob(300), 'image/jpeg')
  assert.ok((await second.stats()).bytes <= 500)
})

test('remove() deletes the file', async () => {
  const { cache, dir } = await setup(10_000)
  const k = '9'.repeat(40)
  await cache.put(k, blob(50), 'image/jpeg')
  await cache.remove(k)
  assert.equal(await cache.get(k), null)
  assert.equal((await fs.readdir(dir)).length, 0)
})
