import type { ConnectedAccount, File } from '@prisma/client'
import type { Response } from 'express'
import { streamGoogleFile } from './stream-google-file.js'
import { streamCloudinaryFile } from '../cloudinary/cloudinary.service.js'
import { streamS3File } from '../s3/s3.service.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

export function streamProviderFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  if (file.provider === 's3') return streamS3File(file, range, res, options)
  if (file.provider === 'cloudinary') return streamCloudinaryFile(file, range, res, options)
  return streamGoogleFile(file, range, res, options)
}
