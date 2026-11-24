import { prisma } from '../../config/prisma.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { createOAuthClient } from './google.service.js'

export async function createGoogleConnectionLink(userId: string, mode: 'direct' | 'link', providerConfigId?: string) {
  const config = providerConfigId
    ? await prisma.providerConfig.findFirstOrThrow({ where: { id: providerConfigId, OR: [{ userId }, { userId: null }], provider: 'google_drive', status: 'active' } })
    : await prisma.providerConfig.findFirstOrThrow({ where: { userId: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
  const state = randomToken()
  const expiresAt = new Date(Date.now() + (mode === 'link' ? 30 : 10) * 60_000)
  await prisma.oauthState.create({ data: { userId, providerConfigId: config.id, flow: mode === 'link' ? 'connect_link' : 'connect', stateHash: hashToken(state), expiresAt } })
  const url = createOAuthClient(config).generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: true, scope: config.scopes as string[] })
  return { url, state }
}