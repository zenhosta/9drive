import { createHash } from 'node:crypto'

export type ResourceType = 'image' | 'video' | 'raw'

// Signature = SHA-1(sorted "k=v" pairs joined by "&" + api_secret). `file`, `cloud_name`,
// `resource_type` and `api_key` are sent with the request but never signed.
export function signParams(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return createHash('sha1').update(toSign + apiSecret).digest('hex')
}

// Cloudinary files all live in one flat namespace per cloud; audio is stored as "video".
export function cloudinaryResourceType(mimeType: string): ResourceType {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video'
  return 'raw'
}

export function buildCloudinaryPublicId(config: { folder: string }, fileId: string) {
  return `${config.folder.replace(/^\/+|\/+$/g, '')}/${fileId}`
}

export function buildProviderFileId(resourceType: ResourceType, publicId: string, format?: string) {
  const path = resourceType !== 'raw' && format ? `${publicId}.${format}` : publicId
  return `${resourceType}:${path}`
}

// providerFileId is "<resource_type>:<path as used in the delivery URL>", e.g. "video:multinary/<id>.mp4".
export function parseProviderFileId(providerFileId: string) {
  const separator = providerFileId.indexOf(':')
  const resourceType = providerFileId.slice(0, separator) as ResourceType
  const path = providerFileId.slice(separator + 1)
  // For image/video the URL carries the format as an extension; the public_id does not.
  const publicId = resourceType === 'raw' ? path : path.replace(/\.[A-Za-z0-9]+$/, '')
  return { resourceType, path, publicId }
}
