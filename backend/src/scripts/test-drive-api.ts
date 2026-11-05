/*
 * HTTP-level checks of the drive browser API against the real database and Drive accounts.
 * Creates a temporary login session (removed at the end) and a few tiny throwaway files named 9drive-move-test-*.
 *   npx tsx src/scripts/test-drive-api.ts
 */
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { google } from 'googleapis'
import { app } from '../app.js'
import { prisma } from '../config/prisma.js'
import { createFolder, listChildFolders } from '../modules/google/google-copy.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, syncGoogleAppFolderFiles, syncGoogleQuota } from '../modules/google/google.service.js'
import { indexTrackedFile } from '../modules/drive-index/drive-scan.js'
import { signAccessToken } from '../utils/jwt.js'
import { hashToken } from '../utils/crypto.js'

const results: Array<{ ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)
}

async function driveOf(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  return { account, drive: google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) }) }
}

async function main() {
  const accounts = await prisma.connectedAccount.findMany({ where: { provider: 'google_drive', status: 'connected' }, include: { storageAccount: true }, orderBy: { createdAt: 'asc' } })
  const userId = accounts[0].userId
  const pool = accounts.filter((a) => a.userId === userId)
  await Promise.allSettled(pool.map((a) => syncGoogleQuota(a.id)))
  const fresh = await prisma.connectedAccount.findMany({ where: { id: { in: pool.map((a) => a.id) } }, include: { storageAccount: true } })
  const roomy = fresh.filter((a) => (a.storageAccount?.availableBytes ?? 0n) > 50n * 1024n * 1024n)
  const [source, target] = [roomy[0], roomy[1]]
  if (!source || !target) throw new Error('Need two accounts with free space.')

  const session = await prisma.userSession.create({ data: { userId, refreshTokenHash: hashToken(crypto.randomUUID()), userAgent: 'test-drive-api', expiresAt: new Date(Date.now() + 15 * 60_000) } })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const headers = { Authorization: `Bearer ${signAccessToken({ sub: userId, sid: session.id })}`, 'Content-Type': 'application/json' }
  const api = async <T = any>(path: string, init?: RequestInit) => {
    const r = await fetch(`${base}${path}`, { ...init, headers })
    return { status: r.status, body: (await r.json().catch(() => null)) as T }
  }

  const tag = Date.now().toString(36)
  const driveCleanup: Array<{ accountId: string; id: string }> = []
  const fileIds: string[] = []
  try {
    // ---- read-only checks on the real index ----
    const scan = await api('/drive-index/scan')
    check('scan status lists every drive', scan.status === 200 && scan.body.accounts.length === pool.length, `${scan.body?.accounts?.length}`)
    const summary = await api('/drive-index/summary')
    const catSum = summary.body.categories.reduce((s: number, c: any) => s + c.count, 0)
    const driveSum = summary.body.drives.reduce((s: number, d: any) => s + d.count, 0)
    check('type counts add up to the total', summary.status === 200 && catSum === summary.body.total.count, `${catSum}/${summary.body.total.count}`)
    check('per-drive counts add up to the total', driveSum === summary.body.total.count, `${driveSum}/${summary.body.total.count}`)
    const images = await api('/drive-index?category=images&pageSize=5')
    check('type list returns only that type', images.status === 200 && images.body.files.every((f: any) => f.category === 'images'), `${images.body.total} images`)
    const root = await api('/drive-index/browse?path=My%20Drive')
    if (root.status !== 200) console.log('browse failed:', root.status, JSON.stringify(root.body).slice(0, 300))
    const nested = root.body.folders.reduce((s: number, f: any) => s + f.count, 0)
    check('folder tree: folders + direct files cover every file', root.status === 200 && nested + root.body.total === summary.body.total.count, `${nested}+${root.body.total}=${summary.body.total.count}`)
    const firstFolder = root.body.folders[0]
    if (firstFolder) {
      const inner = await api(`/drive-index/browse?path=${encodeURIComponent(firstFolder.path)}`)
      const innerSum = inner.body.folders.reduce((s: number, f: any) => s + f.count, 0) + inner.body.total
      check('opening a folder shows exactly its contents', inner.status === 200 && innerSum === firstFolder.count, `${innerSum}/${firstFolder.count}`)
    }
    const pick = await api('/drive-index/select-by-size?bytes=1073741824')
    check('select-by-size reaches 1 GB with the largest files', pick.status === 200 && pick.body.reachedTarget === true && BigInt(pick.body.totalBytes) >= 1073741824n, `${pick.body.count} files`)
    const live = await api(`/drive-index/folders?accountId=${target.id}`)
    check('destination folder list comes from the live Drive', live.status === 200 && Array.isArray(live.body.folders), `${live.body?.folders?.length} folders`)

    // ---- move a raw drive item into a NEW folder the user creates ----
    const { drive: sourceDrive, account: sourceAccount } = await driveOf(source.id)
    const buf = Buffer.from(`9drive folder test ${tag}\n`.repeat(4000))
    const md5 = crypto.createHash('md5').update(buf).digest('hex')
    const mk = async (suffix: string) => {
      const name = `9drive-move-test-${tag}-${suffix}.txt`
      const c = await sourceDrive.files.create({ requestBody: { name, parents: ['root'] }, media: { mimeType: 'text/plain', body: Readable.from(buf) }, fields: 'id' })
      driveCleanup.push({ accountId: source.id, id: c.data.id! })
      return { name, id: c.data.id! }
    }
    const a = await mk('a')
    const itemA = await prisma.driveItem.create({ data: { userId, connectedAccountId: source.id, providerFileId: a.id, name: a.name, mimeType: 'text/plain', sizeBytes: BigInt(buf.length), md5, path: 'My Drive', scanId: crypto.randomUUID() } })
    const parent = await api('/drive-index/folders', { method: 'POST', body: JSON.stringify({ accountId: target.id, parentId: 'root', name: `9drive-move-test-dest-${tag}` }) })
    check('can create a new destination folder', parent.status === 201 && Boolean(parent.body.folder?.id), parent.body?.folder?.path)
    driveCleanup.push({ accountId: target.id, id: parent.body.folder.id })
    const child = await api('/drive-index/folders', { method: 'POST', body: JSON.stringify({ accountId: target.id, parentId: parent.body.folder.id, name: 'inner' }) })
    check('can create a folder inside a folder', child.status === 201 && child.body.folder.path.endsWith('/inner'), child.body?.folder?.path)
    const mv = await api('/files/move-to-account', { method: 'POST', body: JSON.stringify({ driveItemIds: [itemA.id], targetAccountId: target.id, targetFolderId: child.body.folder.id }) })
    check('move into the chosen folder is accepted', mv.status === 202, JSON.stringify(mv.body).slice(0, 120))
    const jobA = await waitJob(api, mv.body.jobId)
    const movedA = await prisma.driveItem.findUniqueOrThrow({ where: { id: itemA.id } })
    driveCleanup.push({ accountId: target.id, id: movedA.providerFileId })
    check('job completed', jobA === 'completed', jobA)
    const { drive: targetDrive } = await driveOf(target.id)
    const meta = await targetDrive.files.get({ fileId: movedA.providerFileId, fields: 'md5Checksum,parents' })
    check('copy is verified (md5) and sits in the chosen folder', meta.data.md5Checksum === md5 && meta.data.parents?.[0] === child.body.folder.id)
    check('index path shows the chosen folder', movedA.path === child.body.folder.path, movedA.path)
    const gone = await sourceDrive.files.get({ fileId: a.id, fields: 'id' }).then(() => false).catch((e) => e.code === 404)
    check('original is gone from the source', gone)

    // ---- a 9Drive-tracked file moved outside 9drive must survive Sync Drive ----
    const b = await mk('b')
    const folderB = await prisma.folder.create({ data: { userId, name: `move-test-${tag}`, provider: 'google_drive' } })
    const fileB = await prisma.file.create({ data: { userId, connectedAccountId: source.id, folderId: folderB.id, provider: 'google_drive', providerFileId: b.id, name: b.name, mimeType: 'text/plain', sizeBytes: BigInt(buf.length) } })
    fileIds.push(fileB.id)
    await indexTrackedFile(fileB)
    const mvB = await api('/files/move-to-account', { method: 'POST', body: JSON.stringify({ fileIds: [fileB.id], targetAccountId: target.id, targetFolderId: child.body.folder.id }) })
    const jobB = await waitJob(api, mvB.body.jobId)
    const movedB = await prisma.file.findUniqueOrThrow({ where: { id: fileB.id } })
    driveCleanup.push({ accountId: target.id, id: movedB.providerFileId })
    check('tracked file moved into custom folder', jobB === 'completed' && movedB.connectedAccountId === target.id && movedB.folderId === folderB.id)
    await syncGoogleAppFolderFiles(target.id, userId)
    const afterSync = await prisma.file.findUniqueOrThrow({ where: { id: fileB.id } })
    check('Sync Drive keeps a tracked file that lives outside the 9drive folder', afterSync.status === 'active' && afterSync.folderId === folderB.id)

    // ---- older cached frontends send `fileId` for rebalance items; the server must accept it ----
    const c = await mk('c')
    const itemC = await prisma.driveItem.create({ data: { userId, connectedAccountId: source.id, providerFileId: c.id, name: c.name, mimeType: 'text/plain', sizeBytes: BigInt(buf.length), md5, path: 'My Drive', scanId: crypto.randomUUID() } })
    const ex = await api('/storage/rebalance/execute', { method: 'POST', body: JSON.stringify({ sourceAccountId: source.id, items: [{ fileId: itemC.id, targetAccountId: target.id }] }) })
    check('rebalance execute accepts the legacy fileId field', ex.status === 202, JSON.stringify(ex.body).slice(0, 120))
    if (ex.status === 202) {
      check('rebalance job completed', (await waitJob(api, ex.body.jobId)) === 'completed')
      driveCleanup.push({ accountId: target.id, id: (await prisma.driveItem.findUniqueOrThrow({ where: { id: itemC.id } })).providerFileId })
    }
    const ex2 = await api('/storage/rebalance/execute', { method: 'POST', body: JSON.stringify({ sourceAccountId: source.id, items: [{ driveItemId: itemC.id, targetAccountId: target.id }] }) })
    check('rebalance execute rejects an already-moved file cleanly (no crash)', ex2.status === 400, `${ex2.status}`)
    const plan = await api('/storage/rebalance/plan', { method: 'POST', body: JSON.stringify({ sourceAccountId: source.id, freeUpBytes: String(5 * 1024 * 1024) }) })
    check('rebalance plan works on the drive index', plan.status === 200 && plan.body.items.length > 0 && plan.body.items.every((i: any) => i.driveItemId && i.fileId), `${plan.body?.items?.length} files`)
    void sourceAccount
  } finally {
    for (const c of driveCleanup) { try { await (await driveOf(c.accountId)).drive.files.delete({ fileId: c.id }) } catch { /* gone */ } }
    await prisma.moveJob.deleteMany({ where: { items: { some: { fileName: { startsWith: '9drive-move-test-' } } } } }).catch(() => undefined)
    await prisma.driveItem.deleteMany({ where: { name: { startsWith: '9drive-move-test-' } } }).catch(() => undefined)
    await prisma.file.deleteMany({ where: { name: { startsWith: '9drive-move-test-' } } }).catch(() => undefined)
    await prisma.folder.deleteMany({ where: { name: { startsWith: 'move-test-' } } }).catch(() => undefined)
    await prisma.userSession.delete({ where: { id: session.id } }).catch(() => undefined)
    await Promise.allSettled([syncGoogleQuota(source.id), syncGoogleQuota(target.id)])
    server.close()
    void fileIds
    void createFolder
    void listChildFolders
    void ensureGoogleAppFolder
  }
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  process.exitCode = failed ? 1 : 0
}

async function waitJob(api: <T = any>(p: string) => Promise<{ status: number; body: T }>, jobId: string) {
  for (let i = 0; i < 120; i += 1) {
    const r = await api<any>(`/jobs/${jobId}`)
    const status = r.body?.job?.status
    if (status && !['queued', 'running'].includes(status)) return status as string
    await new Promise((res) => setTimeout(res, 1500))
  }
  return 'timeout'
}

main()
  .catch((e) => { console.error('test aborted:', e instanceof Error ? e.message : e); process.exitCode = 2 })
  .finally(async () => { await prisma.$disconnect(); setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref() })
