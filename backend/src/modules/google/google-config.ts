import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../utils/http-error.js'

export async function getGlobalGoogleConfig() {
  const config = await prisma.providerConfig.findFirst({ where: { userId: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
  if (!config) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', 'Google is not configured on this server. An administrator can add it in Settings.')
  return config
}
