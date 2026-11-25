import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/*
 * On-disk cache for thumbnails so scrolling a drive doesn't re-download them from Google each time.
 *  - an entry is deleted if it hasn't been used for `ttlMs` (7 days by default);
 *  - the total size is capped at `maxBytes` (1 GiB by default); when it is exceeded the least recently used
 *    entries are deleted first and the recent ones are kept.
 * It is a cache only: losing it (container rebuild) costs nothing but a re-download.
 */

export type ThumbCacheOptions = { dir: string; maxBytes: number; ttlMs: number; now?: () => number }
type Entry = { file: string; size: number; atime: number; type: string }

const EXT_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const TYPE_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bin: 'image/jpeg' }

export class ThumbCache {
  private index = new Map<string, Entry>()
  private total = 0
  private ready: Promise<void>
  private now: () => number

  constructor(private opts: ThumbCacheOptions) {
    this.now = opts.now ?? Date.now
    this.ready = this.init()
  }

  static key(accountId: string, providerFileId: string) {
    return crypto.createHash('sha256').update(`${accountId}:${providerFileId}`).digest('hex').slice(0, 40)
  }

  private async init() {
    await fs.mkdir(this.opts.dir, { recursive: true })
    for (const name of await fs.readdir(this.opts.dir)) {
      const match = /^([0-9a-f]{40})\.(jpg|png|webp|gif|bin)$/.exec(name)
      const full = path.join(this.opts.dir, name)
      if (!match) { await fs.rm(full, { force: true }); continue } // stray or half-written file
      const stat = await fs.stat(full)
      this.index.set(match[1], { file: full, size: stat.size, atime: stat.mtimeMs, type: TYPE_BY_EXT[match[2]] })
      this.total += stat.size
    }
    await this.sweepNow()
    await this.enforce()
  }

  async get(key: string): Promise<{ data: Buffer; type: string } | null> {
    await this.ready
    const entry = this.index.get(key)
    if (!entry) return null
    if (this.now() - entry.atime > this.opts.ttlMs) { await this.remove(key); return null }
    try {
      const data = await fs.readFile(entry.file)
      entry.atime = this.now()
      fs.utimes(entry.file, entry.atime / 1000, entry.atime / 1000).catch(() => undefined) // remember use across restarts
      return { data, type: entry.type }
    } catch {
      await this.remove(key)
      return null
    }
  }

  async put(key: string, data: Buffer, type: string) {
    await this.ready
    if (data.length > this.opts.maxBytes) return
    await this.remove(key)
    const ext = EXT_BY_TYPE[type] ?? 'bin'
    const file = path.join(this.opts.dir, `${key}.${ext}`)
    const tmp = `${file}.tmp-${process.pid}`
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file)
    const atime = this.now()
    await fs.utimes(file, atime / 1000, atime / 1000).catch(() => undefined)
    this.index.set(key, { file, size: data.length, atime, type: TYPE_BY_EXT[ext] })
    this.total += data.length
    await this.enforce()
  }

  async remove(key: string) {
    const entry = this.index.get(key)
    if (!entry) return
    this.index.delete(key)
    this.total -= entry.size
    await fs.rm(entry.file, { force: true })
  }

  /** Deletes every entry that has not been used within the TTL. */
  async sweep() {
    await this.ready
    await this.sweepNow()
  }

  private async sweepNow() {
    const cutoff = this.now() - this.opts.ttlMs
    for (const [key, entry] of [...this.index]) if (entry.atime < cutoff) await this.remove(key)
  }

  /** Over the size cap: delete the least recently used entries until there is some headroom. */
  private async enforce() {
    if (this.total <= this.opts.maxBytes) return
    const target = this.opts.maxBytes * 0.9
    const oldestFirst = [...this.index].sort((a, b) => a[1].atime - b[1].atime)
    for (const [key] of oldestFirst) {
      if (this.total <= target) break
      await this.remove(key)
    }
  }

  async stats() {
    await this.ready
    return { count: this.index.size, bytes: this.total }
  }
}

const MAX_MB = Number(process.env.THUMB_CACHE_MAX_MB) > 0 ? Number(process.env.THUMB_CACHE_MAX_MB) : 1024
const TTL_DAYS = Number(process.env.THUMB_CACHE_TTL_DAYS) > 0 ? Number(process.env.THUMB_CACHE_TTL_DAYS) : 7

export const thumbCache = new ThumbCache({
  dir: process.env.THUMB_CACHE_DIR || path.join(os.tmpdir(), '9drive-thumbs'),
  maxBytes: MAX_MB * 1024 * 1024,
  ttlMs: TTL_DAYS * 24 * 60 * 60 * 1000,
})

export function startThumbCacheSweeper() {
  setInterval(() => void thumbCache.sweep().catch(() => undefined), 60 * 60 * 1000).unref()
}

/** Called when a file is deleted or moved: its thumbnail is no longer needed. */
export function dropThumb(accountId: string, providerFileId: string) {
  return thumbCache.remove(ThumbCache.key(accountId, providerFileId)).catch(() => undefined)
}
