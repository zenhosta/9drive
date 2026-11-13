import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { HttpError } from '../middleware/error.middleware.js'

const DEFAULT_MESSAGE =
  'No Google Drive credentials are configured on this server yet. An administrator must add the Google client ID and secret in Settings -> Google credentials, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment.'

/**
 * Finds the Google Drive OAuth config the app should use.
 *
 * A server that has never been given Google OAuth credentials used to fail with
 * a Prisma P2025, which surfaced to the mobile app as the opaque
 * "Resource not found." reply. Report the real cause instead so the client can
 * tell the user what to fix.
 */
export async function requireGoogleProviderConfig(options: {
  configId?: string
  userId?: string
  message?: string
} = {}) {
  const where: Prisma.ProviderConfigWhereInput = options.configId
    ? {
      id: options.configId,
      provider: 'google_drive',
      status: 'active',
      OR: [{ userId: options.userId ?? '' }, { userId: null }],
    }
    : { userId: null, provider: 'google_drive', status: 'active' }

  const config = await prisma.providerConfig.findFirst({ where, orderBy: { createdAt: 'desc' } })
  if (!config) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', options.message ?? DEFAULT_MESSAGE)
  return config
}
