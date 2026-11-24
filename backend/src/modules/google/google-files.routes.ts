import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { changeGoogleFile, createGoogleFolder, listGoogleFilesPage } from './google-files.service.js'

export const googleFilesRouter = Router()
googleFilesRouter.use(requireAuth)
const accountId = z.uuid()
const fileId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(255)

googleFilesRouter.get('/:accountId', async (req: AuthRequest, res) => {
  try {
    const query = z.object({ parentId: fileId.optional(), q: z.string().trim().max(255).optional(), pageToken: z.string().max(4096).optional() }).parse(req.query)
    res.setHeader('Cache-Control', 'no-store')
    res.json(await listGoogleFilesPage(req.user!.id, accountId.parse(req.params.accountId), query))
  } catch { res.status(503).json({ code: 'GOOGLE_FILES_FAILED', message: 'Não foi possível carregar este Drive. Confira a conexão e tente atualizar.' }) }
})

googleFilesRouter.patch('/:accountId/:fileId', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ name: z.string().trim().max(255).optional(), trashed: z.boolean().optional() }).parse(req.body)
    if (!body.name && body.trashed === undefined) return res.status(400).json({ code: 'INVALID_BODY', message: 'Nada para atualizar.' })
    res.json(await changeGoogleFile(req.user!.id, accountId.parse(req.params.accountId), fileId.parse(req.params.fileId), body))
  } catch { res.status(503).json({ code: 'GOOGLE_FILES_FAILED', message: 'Não foi possível atualizar. Confira a conexão.' }) }
})

googleFilesRouter.post('/:accountId/folders', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ name: z.string().trim().max(255).min(1), parentId: fileId.optional() }).parse(req.body)
    res.json(await createGoogleFolder(req.user!.id, accountId.parse(req.params.accountId), body.name, body.parentId))
  } catch { res.status(503).json({ code: 'GOOGLE_FOLDER_CREATE_FAILED', message: 'Não foi possível criar a pasta.' }) }
})