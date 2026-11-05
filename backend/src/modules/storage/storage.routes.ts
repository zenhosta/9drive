import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { syncGoogleQuota } from '../google/google.service.js'
import { syncS3Quota } from '../s3/s3.service.js'

export const storageRouter = Router()
storageRouter.use(requireAuth)

type BreakdownRow = { kind: string; bytes: bigint | number | string | null }

function bytesToString(value: bigint | number | string | null | undefined) {
  if (value === null || value === undefined) return '0'
  return value.toString()
}

const routingModes = ['most_available', 'round_robin', 'priority'] as const
const routingPolicySchema = z.object({ mode: z.enum(routingModes), priorityAccountIds: z.array(z.string().min(1)).max(100).optional() })

function normalizePriorityAccountIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function getOrCreateRoutingPolicy(userId: string) {
  return prisma.uploadRoutingPolicy.upsert({
    where: { userId },
    create: { userId, mode: 'most_available', priorityAccountIds: [] },
    update: {},
  })
}

storageRouter.get('/summary', async (req: AuthRequest, res, next) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({ where: { userId: req.user!.id, status: 'connected' }, include: { storageAccount: true } })
    const summary = accounts.reduce((acc, account) => {
      const storage = account.storageAccount
      acc.totalBytes += storage?.totalBytes ?? 0n
      acc.usedBytes += storage?.usedBytes ?? 0n
      acc.availableBytes += storage?.availableBytes ?? 0n
      return acc
    }, { totalBytes: 0n, usedBytes: 0n, availableBytes: 0n })

    return res.json({
      totalBytes: summary.totalBytes.toString(),
      usedBytes: summary.usedBytes.toString(),
      availableBytes: summary.availableBytes.toString(),
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.email,
        status: account.status,
        totalBytes: account.storageAccount?.totalBytes?.toString() ?? null,
        usedBytes: account.storageAccount?.usedBytes.toString() ?? '0',
        availableBytes: account.storageAccount?.availableBytes?.toString() ?? null,
        lastSyncedAt: account.storageAccount?.lastSyncedAt ?? null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

storageRouter.get('/routing-policy', async (req: AuthRequest, res, next) => {
  try {
    const policy = await getOrCreateRoutingPolicy(req.user!.id)
    return res.json({ policy: { id: policy.id, mode: policy.mode, priorityAccountIds: normalizePriorityAccountIds(policy.priorityAccountIds), roundRobinCursor: policy.roundRobinCursor } })
  } catch (error) {
    return next(error)
  }
})

storageRouter.patch('/routing-policy', async (req: AuthRequest, res, next) => {
  try {
    const body = routingPolicySchema.parse(req.body)
    const accountIds = [...new Set(body.priorityAccountIds ?? [])]
    const validAccounts = accountIds.length === 0 ? [] : await prisma.connectedAccount.findMany({ where: { id: { in: accountIds }, userId: req.user!.id, status: 'connected' }, select: { id: true } })
    const validIds = new Set(validAccounts.map((account) => account.id))
    const priorityAccountIds = accountIds.filter((id) => validIds.has(id))
    const policy = await prisma.uploadRoutingPolicy.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, mode: body.mode, priorityAccountIds, roundRobinCursor: 0 },
      update: { mode: body.mode, priorityAccountIds, ...(body.mode !== 'round_robin' ? { roundRobinCursor: 0 } : {}) },
    })
    return res.json({ policy: { id: policy.id, mode: policy.mode, priorityAccountIds: normalizePriorityAccountIds(policy.priorityAccountIds), roundRobinCursor: policy.roundRobinCursor } })
  } catch (error) {
    return next(error)
  }
})

storageRouter.get('/breakdown', async (req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.$queryRaw<BreakdownRow[]>`
      SELECT
        CASE
          WHEN mime_type LIKE 'image/%' THEN 'photo'
          WHEN mime_type LIKE 'video/%' THEN 'video'
          ELSE 'document'
        END AS kind,
        COALESCE(SUM(size_bytes), 0) AS bytes
      FROM files
      WHERE user_id = ${req.user!.id} AND status = 'active'
      GROUP BY kind
    `
    const breakdown = { photo: '0', video: '0', document: '0' }
    for (const row of rows) {
      if (row.kind === 'photo' || row.kind === 'video' || row.kind === 'document') breakdown[row.kind] = bytesToString(row.bytes)
    }
    return res.json(breakdown)
  } catch (error) {
    return next(error)
  }
})

type AccountHealth = 'ok' | 'needs_reconnect' | 'error'

// lastError is free text written by quota-sync and upload failures; map the auth-related ones to a reconnect prompt.
function deriveHealth(account: { provider: string; lastError: string | null; accessTokenEncrypted: string | null; refreshTokenEncrypted: string | null }): AccountHealth {
  if (account.provider === 'google_drive' && (!account.accessTokenEncrypted || !account.refreshTokenEncrypted)) return 'needs_reconnect'
  if (!account.lastError) return 'ok'
  return /invalid_grant|tokens? (are )?missing|unauthorized|invalid_client|revoked|expired|401/i.test(account.lastError) ? 'needs_reconnect' : 'error'
}

async function loadOverview(userId: string) {
  const [accounts, fileStats] = await Promise.all([
    prisma.connectedAccount.findMany({ where: { userId, status: 'connected' }, include: { storageAccount: true }, orderBy: { createdAt: 'asc' } }),
    prisma.file.groupBy({ by: ['connectedAccountId'], where: { userId, status: 'active' }, _count: { _all: true }, _sum: { sizeBytes: true } }),
  ])
  const statsByAccount = new Map(fileStats.map((row) => [row.connectedAccountId, { count: row._count._all, bytes: row._sum.sizeBytes ?? 0n }]))

  let totalBytes = 0n
  let usedBytes = 0n
  let availableBytes = 0n
  let totalFiles = 0
  let totalFileBytes = 0n
  let unlimitedAccounts = 0

  const rows = accounts.map((account) => {
    const storage = account.storageAccount
    const stats = statsByAccount.get(account.id) ?? { count: 0, bytes: 0n }
    const unlimited = !storage || storage.totalBytes === null
    if (unlimited) unlimitedAccounts += 1
    else {
      totalBytes += storage.totalBytes ?? 0n
      availableBytes += storage.availableBytes ?? 0n
    }
    usedBytes += storage?.usedBytes ?? 0n
    totalFiles += stats.count
    totalFileBytes += stats.bytes
    return {
      id: account.id,
      provider: account.provider,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      totalBytes: storage?.totalBytes?.toString() ?? null,
      usedBytes: storage?.usedBytes.toString() ?? '0',
      availableBytes: storage?.availableBytes?.toString() ?? null,
      trashBytes: storage?.trashBytes?.toString() ?? null,
      unlimited,
      lastSyncedAt: storage?.lastSyncedAt ?? null,
      fileCount: stats.count,
      fileBytes: stats.bytes.toString(),
      health: deriveHealth(account),
      lastError: account.lastError,
    }
  })

  return {
    totals: {
      accountCount: accounts.length,
      unlimitedAccounts,
      // Capacity/free cover accounts with a known limit only; used covers every account.
      totalBytes: totalBytes.toString(),
      usedBytes: usedBytes.toString(),
      availableBytes: availableBytes.toString(),
      fileCount: totalFiles,
      fileBytes: totalFileBytes.toString(),
    },
    accounts: rows,
  }
}

storageRouter.get('/overview', async (req: AuthRequest, res, next) => {
  try {
    return res.json(await loadOverview(req.user!.id))
  } catch (error) {
    return next(error)
  }
})

storageRouter.post('/overview/refresh', async (req: AuthRequest, res, next) => {
  try {
    const accounts = await prisma.connectedAccount.findMany({ where: { userId: req.user!.id, status: 'connected' }, select: { id: true, email: true, provider: true } })
    const results = await Promise.all(accounts.map(async (account) => {
      try {
        if (account.provider === 's3') await syncS3Quota(account.id)
        else await syncGoogleQuota(account.id)
        await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastError: null } })
        return { accountId: account.id, ok: true as const }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Quota sync failed'
        await prisma.connectedAccount.update({ where: { id: account.id }, data: { lastError: message.slice(0, 1000) } }).catch(() => undefined)
        return { accountId: account.id, ok: false as const, message }
      }
    }))
    return res.json({ results, overview: await loadOverview(req.user!.id) })
  } catch (error) {
    return next(error)
  }
})
