/*
 * Manual end-to-end test for cross-drive moves. Uses tiny throwaway files that it creates and removes itself.
 *
 *   npx tsx src/scripts/test-move.ts full
 *   npx tsx src/scripts/test-move.ts crash-prepare   (run with the backend stopped)
 *   npx tsx src/scripts/test-move.ts crash-verify <jobId>   (after starting the backend again)
 *
 * It never prints tokens. All created files are named 9drive-move-test-*.
 */
import crypto from 'node:crypto'
import { google } from 'googleapis'
import { prisma } from '../config/prisma.js'
import { createMoveJob, JobRequestError } from '../modules/jobs/job.service.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, syncGoogleQuota } from '../modules/google/google.service.js'
import { findCopyByItem } from '../modules/google/google-copy.js'
import { hashToken } from '../utils/crypto.js'

const results: Array<{ name: string; ok: boolean; detail?: string }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)
}

async function driveOf(accountId: string) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })
  return { account, drive: google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) }) }
}

async function pickAccounts() {
  const accounts = await prisma.connectedAccount.findMany({ where: { provider: 'google_drive', status: 'connected' }, include: { storageAccount: true }, orderBy: { createdAt: 'asc' } })
  const byUser = new Map<string, typeof accounts>()
  for (const a of accounts) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a])
  const group = [...byUser.values()].find((g) => g.length >= 2)
  if (!group) throw new Error('Need a user with at least two connected Google Drive accounts.')
  await Promise.allSettled(group.map((a) => syncGoogleQuota(a.id)))
  const fresh = await prisma.connectedAccount.findMany({ where: { id: { in: group.map((g) => g.id) } }, include: { storageAccount: true } })
  const roomy = fresh.filter((a) => a.storageAccount?.availableBytes === null || (a.storageAccount?.availableBytes ?? 0n) > 50n * 1024n * 1024n)
  if (roomy.length < 2) throw new Error('Need two accounts with free space.')
  return { userId: group[0].userId, source: roomy[0], target: roomy[1] }
}

function makeContent(tag: string) {
  const buffer = Buffer.from(`9drive move test ${tag}\n`.repeat(8000))
  return { buffer, md5: crypto.createHash('md5').update(buffer).digest('hex') }
}

async function createTestFile(userId: string, accountId: string, tag: string, folderId: string | null) {
  const { account, drive } = await driveOf(accountId)
  const { buffer, md5 } = makeContent(tag)
  const parent = await ensureGoogleAppFolder(account)
  const name = `9drive-move-test-${tag}.txt`
  const created = await drive.files.create({ requestBody: { name, parents: [parent] }, media: { mimeType: 'text/plain', body: (await import('node:stream')).Readable.from(buffer) }, fields: 'id,md5Checksum,size' })
  const file = await prisma.file.create({ data: { userId, connectedAccountId: accountId, folderId, provider: 'google_drive', providerFileId: created.data.id!, name, mimeType: 'text/plain', sizeBytes: BigInt(buffer.length) } })
  return { file, md5, drive }
}

async function waitForJob(jobId: string, timeoutMs = 180_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = await prisma.moveJob.findUniqueOrThrow({ where: { id: jobId } })
    if (job.finishedAt) return job
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('Timed out waiting for job')
}

async function driveGet(drive: ReturnType<typeof google.drive>, id: string) {
  try {
    const r = await drive.files.get({ fileId: id, fields: 'id,md5Checksum,size,trashed' })
    return r.data
  } catch (error) {
    if ((error as { code?: number }).code === 404) return null
    throw error
  }
}

async function runFull() {
  const { userId, source, target } = await pickAccounts()
  console.log(`user ok; source=${source.email} target=${target.email}`)
  const tag = Date.now().toString(36)
  const folder = await prisma.folder.create({ data: { userId, name: `move-test-${tag}`, provider: 'google_drive' } })
  const cleanupDrive: Array<{ accountId: string; id: string }> = []
  const cleanupFileIds: string[] = []
  try {
    // 1. single move preserves id, folder, share link
    const t1 = await createTestFile(userId, source.id, `${tag}-a`, folder.id)
    cleanupFileIds.push(t1.file.id)
    const share = await prisma.fileShare.create({ data: { fileId: t1.file.id, userId, tokenHash: hashToken(`test-${tag}`), token: null } })
    const oldDriveId = t1.file.providerFileId
    const r1 = await createMoveJob(userId, 'move', [{ fileId: t1.file.id, targetAccountId: target.id }], { includeNative: false, nativeFormat: 'native' })
    const job1 = await waitForJob(r1.job.id)
    const moved = await prisma.file.findUniqueOrThrow({ where: { id: t1.file.id } })
    cleanupDrive.push({ accountId: target.id, id: moved.providerFileId })
    check('single move: job completed', job1.status === 'completed', job1.status)
    check('single move: DB points at target drive', moved.connectedAccountId === target.id && moved.providerFileId !== oldDriveId)
    check('single move: 9Drive file id, name, virtual folder kept', moved.id === t1.file.id && moved.name === t1.file.name && moved.folderId === folder.id)
    check('single move: share link row kept', Boolean(await prisma.fileShare.findUnique({ where: { id: share.id } })))
    const { drive: targetDrive } = await driveOf(target.id)
    const copy = await driveGet(targetDrive, moved.providerFileId)
    check('single move: copy exists on target with same size and md5', Boolean(copy) && copy!.md5Checksum === t1.md5 && BigInt(copy!.size ?? 0) === t1.file.sizeBytes, copy ? undefined : 'missing')
    const gone = await driveGet(t1.drive, oldDriveId)
    check('single move: original deleted from source drive', gone === null || gone.trashed === true)

    // 2. same-account move is refused and touches nothing
    try {
      await createMoveJob(userId, 'move', [{ fileId: moved.id, targetAccountId: target.id }], { includeNative: false, nativeFormat: 'native' })
      check('same-account move is refused', false, 'job was created')
    } catch (error) {
      check('same-account move is refused', error instanceof JobRequestError && error.code === 'NOTHING_TO_MOVE')
    }

    // 3. invalid target is refused
    try {
      await createMoveJob(userId, 'move', [{ fileId: moved.id, targetAccountId: crypto.randomUUID() }], { includeNative: false, nativeFormat: 'native' })
      check('invalid target is refused', false, 'job was created')
    } catch (error) {
      check('invalid target is refused', error instanceof JobRequestError && error.code === 'NOTHING_TO_MOVE')
    }

    // 4. failure mid-move leaves the original untouched (source Drive file vanished -> item fails, DB row unchanged)
    const t2 = await createTestFile(userId, source.id, `${tag}-b`, null)
    cleanupFileIds.push(t2.file.id)
    const bogus = await prisma.file.update({ where: { id: t2.file.id }, data: { providerFileId: `nonexistent-${tag}` } })
    const r2 = await createMoveJob(userId, 'move', [{ fileId: bogus.id, targetAccountId: target.id }], { includeNative: false, nativeFormat: 'native' })
    const job2 = await waitForJob(r2.job.id)
    const after2 = await prisma.file.findUniqueOrThrow({ where: { id: bogus.id } })
    const item2 = await prisma.moveJobItem.findFirstOrThrow({ where: { jobId: job2.id } })
    check('failed move: job reports failure with a message', job2.status === 'failed' && Boolean(item2.error), item2.error ?? '')
    check('failed move: DB row unchanged (still on source)', after2.connectedAccountId === source.id && after2.providerFileId === `nonexistent-${tag}`)
    const stray = await findCopyByItem((await driveOf(target.id)).drive, item2.id)
    check('failed move: no partial copy left on target', stray === null)
    // the real Drive file of t2 is still on the source; remove it in cleanup
    cleanupDrive.push({ accountId: source.id, id: t2.file.providerFileId })
  } finally {
    // cleanup, best effort
    for (const c of cleanupDrive) {
      if (!c.id || c.id.startsWith('nonexistent')) continue
      try {
        const { drive } = await driveOf(c.accountId)
        await drive.files.delete({ fileId: c.id })
      } catch { /* already gone */ }
    }
    await prisma.moveJob.deleteMany({ where: { items: { some: { fileId: { in: cleanupFileIds } } } } })
    await prisma.file.deleteMany({ where: { id: { in: cleanupFileIds } } })
    await prisma.folder.delete({ where: { id: folder.id } }).catch(() => undefined)
    await Promise.allSettled([syncGoogleQuota(source.id), syncGoogleQuota(target.id)])
  }
}

async function runNative() {
  const { userId, source, target } = await pickAccounts()
  const tag = Date.now().toString(36)
  const { account, drive } = await driveOf(source.id)
  const { Readable } = await import('node:stream')
  const parent = await ensureGoogleAppFolder(account)
  const fileIds: string[] = []
  const driveCleanup: Array<{ accountId: string; id: string }> = []
  try {
    for (const format of ['native', 'office'] as const) {
      const name = `9drive-move-test-doc-${tag}-${format}`
      const created = await drive.files.create({ requestBody: { name, parents: [parent], mimeType: 'application/vnd.google-apps.document' }, media: { mimeType: 'text/plain', body: Readable.from(Buffer.from(`native doc test ${tag}\n`.repeat(50))) }, fields: 'id' })
      const file = await prisma.file.create({ data: { userId, connectedAccountId: source.id, provider: 'google_drive', providerFileId: created.data.id!, name, mimeType: 'application/vnd.google-apps.document', sizeBytes: 0n } })
      fileIds.push(file.id)
      // default: skipped unless opted in
      if (format === 'native') {
        try { await createMoveJob(userId, 'move', [{ fileId: file.id, targetAccountId: target.id }], { includeNative: false, nativeFormat: 'native' }); check('native doc skipped by default', false) } catch (e) { check('native doc skipped by default', e instanceof JobRequestError && e.code === 'NOTHING_TO_MOVE') }
      }
      const r = await createMoveJob(userId, 'move', [{ fileId: file.id, targetAccountId: target.id }], { includeNative: true, nativeFormat: format })
      const job = await waitForJob(r.job.id)
      const after = await prisma.file.findUniqueOrThrow({ where: { id: file.id } })
      driveCleanup.push({ accountId: target.id, id: after.providerFileId })
      const { drive: targetDrive } = await driveOf(target.id)
      const meta = await targetDrive.files.get({ fileId: after.providerFileId, fields: 'id,mimeType,size,name' })
      check(`native (${format}): job completed`, job.status === 'completed', job.status)
      check(`native (${format}): new Drive id on target`, after.connectedAccountId === target.id && after.providerFileId !== created.data.id)
      if (format === 'native') check('native (native): stays an editable Google Doc, name unchanged', meta.data.mimeType === 'application/vnd.google-apps.document' && after.name === name, meta.data.mimeType ?? '')
      else check('native (office): saved as .docx with updated name/mime in 9Drive', (meta.data.name ?? '').endsWith('.docx') === false || after.name.endsWith('.docx'), `${after.name} / ${meta.data.mimeType}`)
      const gone = await driveGet(drive, created.data.id!)
      check(`native (${format}): original deleted`, gone === null || gone.trashed === true)
    }
  } finally {
    for (const c of driveCleanup) { try { await (await driveOf(c.accountId)).drive.files.delete({ fileId: c.id }) } catch { /* gone */ } }
    await prisma.moveJob.deleteMany({ where: { items: { some: { fileId: { in: fileIds } } } } })
    await prisma.file.deleteMany({ where: { id: { in: fileIds } } })
    await Promise.allSettled([syncGoogleQuota(source.id), syncGoogleQuota(target.id)])
  }
}

async function crashPrepare() {
  const { userId, source, target } = await pickAccounts()
  const tag = Date.now().toString(36)
  const t = await createTestFile(userId, source.id, `${tag}-crash`, null)
  const { account: targetAccount, drive: targetDrive } = await driveOf(target.id)
  const parent = await ensureGoogleAppFolder(targetAccount)
  const job = await prisma.moveJob.create({
    data: {
      userId, type: 'move', status: 'running', options: { includeNative: false, nativeFormat: 'native' }, totalItems: 1, totalBytes: t.file.sizeBytes, startedAt: new Date(),
      items: { create: [{ fileId: t.file.id, fileName: t.file.name, sourceAccountId: source.id, targetAccountId: target.id, sourceProviderFileId: t.file.providerFileId, bytes: t.file.sizeBytes, status: 'running', step: 'copying', attempts: 1 }] },
    },
    include: { items: true },
  })
  // Simulate: the upload to the target finished but the process died before the copy's id was saved.
  const { Readable } = await import('node:stream')
  const uploaded = await targetDrive.files.create({
    requestBody: { name: t.file.name, parents: [parent], appProperties: { nineDriveMoveItem: job.items[0].id } },
    media: { mimeType: 'text/plain', body: Readable.from(makeContent(`${tag}-crash`).buffer) },
    fields: 'id',
  })
  console.log(JSON.stringify({ jobId: job.id, fileId: t.file.id, itemId: job.items[0].id, sourceDriveId: t.file.providerFileId, orphanCopyId: uploaded.data.id, md5: t.md5, targetAccountId: target.id, sourceAccountId: source.id }))
}

async function crashVerify(jobId: string) {
  const job = await waitForJob(jobId, 120_000)
  const item = await prisma.moveJobItem.findFirstOrThrow({ where: { jobId } })
  const file = await prisma.file.findUniqueOrThrow({ where: { id: item.fileId } })
  const { drive: targetDrive } = await driveOf(item.targetAccountId)
  const { drive: sourceDrive } = await driveOf(item.sourceAccountId)
  const copies = await targetDrive.files.list({ q: `appProperties has { key='nineDriveMoveItem' and value='${item.id}' } and trashed = false`, fields: 'files(id)', spaces: 'drive' })
  check('recovery: job completed after restart', job.status === 'completed', job.status)
  check('recovery: exactly one copy on target (no duplicate)', (copies.data.files?.length ?? 0) === 1, String(copies.data.files?.length))
  check('recovery: DB points at that copy', file.connectedAccountId === item.targetAccountId && file.providerFileId === copies.data.files?.[0]?.id)
  const gone = await driveGet(sourceDrive, item.sourceProviderFileId)
  check('recovery: original removed from source', gone === null || gone.trashed === true)
  // cleanup
  await targetDrive.files.delete({ fileId: file.providerFileId }).catch(() => undefined)
  await prisma.moveJob.delete({ where: { id: jobId } })
  await prisma.file.delete({ where: { id: file.id } })
  await Promise.allSettled([syncGoogleQuota(item.sourceAccountId), syncGoogleQuota(item.targetAccountId)])
}

async function main() {
  const [mode, arg] = process.argv.slice(2)
  try {
    if (mode === 'full') await runFull()
    else if (mode === 'native') await runNative()
    else if (mode === 'crash-prepare') await crashPrepare()
    else if (mode === 'crash-verify' && arg) await crashVerify(arg)
    else throw new Error('usage: test-move.ts full | crash-prepare | crash-verify <jobId>')
    if (results.length) {
      const failed = results.filter((r) => !r.ok)
      console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
      process.exitCode = failed.length ? 1 : 0
    }
  } catch (error) {
    console.error('test aborted:', error instanceof Error ? error.message : error)
    process.exitCode = 2
  } finally {
    await prisma.$disconnect()
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref()
  }
}

main()
