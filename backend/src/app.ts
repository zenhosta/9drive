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
import { rateLimit } from './middleware/rate-limit.middleware.js'
import { csrfMiddleware } from './middleware/csrf.middleware.js'

export const app = express()
app.set('trust proxy', env.TRUST_PROXY)

app.use(cors({ origin: env.FRONTEND_URL, credentials: true }))
app.use(csrfMiddleware)
app.use((_req, res, next) => {
	res.setHeader('X-Content-Type-Options', 'nosniff')
	res.setHeader('X-Frame-Options', 'DENY')
	res.setHeader('Referrer-Policy', 'no-referrer')
	res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
	return next()
})
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api', rateLimit('external-api', 60, 60_000), publicApiRouter)
app.use('/public', rateLimit('public-files', 120, 60_000), publicRouter)
app.use('/auth', rateLimit('auth', 30, 60_000), authRouter)
app.use('/api-keys', rateLimit('api-keys', 60, 60_000), apiKeyRouter)
app.use('/provider-configs', providerConfigRouter)
app.use('/connected-accounts', connectedAccountRouter)
app.use('/storage', storageRouter)
app.use('/uploads', rateLimit('uploads', 30, 60_000), uploadRouter)
app.use('/files', fileRouter)
app.use('/folders', folderRouter)
app.use('/invites', inviteRouter)
app.use('/audit-logs', auditLogRouter)
app.use('/system', systemRouter)
app.use(errorMiddleware)
