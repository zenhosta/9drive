import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorMiddleware } from './middleware/error.middleware.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { providerConfigRouter } from './modules/provider-configs/provider-config.routes.js'
import { connectedAccountRouter } from './modules/connected-accounts/connected-account.routes.js'
import { storageRouter } from './modules/storage/storage.routes.js'
import { uploadRouter } from './modules/uploads/upload.routes.js'
import { fileRouter } from './modules/files/file.routes.js'
import { folderRouter } from './modules/folders/folder.routes.js'
import { publicRouter } from './modules/public/public.routes.js'
import { inviteRouter } from './modules/invites/invite.routes.js'
import { apiKeyRouter } from './modules/api-keys/api-key.routes.js'
import { publicApiRouter } from './modules/public-api/public-api.routes.js'
import { auditLogRouter } from './modules/audit-logs/audit-log.routes.js'
import { systemRouter } from './modules/system/system.routes.js'

export const app = express()
app.set('trust proxy', true)

const allowedOrigins = new Set([env.FRONTEND_URL])
if (env.MOBILE_APP_REDIRECT_URL) {
  // Capacitor serves the bundled web app from these origins.
  allowedOrigins.add('https://localhost')
  allowedOrigins.add('capacitor://localhost')
}

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin))
  },
}))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api', publicApiRouter)
app.use('/public', publicRouter)
app.use('/auth', authRouter)
app.use('/api-keys', apiKeyRouter)
app.use('/provider-configs', providerConfigRouter)
app.use('/connected-accounts', connectedAccountRouter)
app.use('/storage', storageRouter)
app.use('/uploads', uploadRouter)
app.use('/files', fileRouter)
app.use('/folders', folderRouter)
app.use('/invites', inviteRouter)
app.use('/audit-logs', auditLogRouter)
app.use('/system', systemRouter)
app.use(errorMiddleware)
