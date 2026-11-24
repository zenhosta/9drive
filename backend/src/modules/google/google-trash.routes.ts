import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { changeGoogleTrash, listGoogleTrash, listGoogleTrashPage } from './google-trash.service.js'

export const googleTrashRouter = Router()
googleTrashRouter.use(requireAuth)
const accountId = z.uuid()
const fileId = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(255)

function message(error: unknown) { return error instanceof Error && error.name === 'TrashError' ? error.message : 'Não foi possível concluir a operação no Google Drive. Atualize a lista e confira a conexão da conta.' }

googleTrashRouter.get('/', async (req: AuthRequest, res) => {
  try { res.json({ accounts: await listGoogleTrash(req.user!.id) }) } catch { res.status(503).json({ code: 'GOOGLE_TRASH_LIST_FAILED', message: 'Não foi possível carregar as lixeiras. Tente novamente.' }) }
})

googleTrashRouter.get('/:accountId', async (req: AuthRequest, res) => {
  try { const query = z.object({ pageToken: z.string().max(4096).optional() }).parse(req.query); res.json(await listGoogleTrashPage(req.user!.id, accountId.parse(req.params.accountId), query.pageToken)) } catch { res.status(503).json({ code: 'GOOGLE_TRASH_PAGE_FAILED', message: 'Não foi possível carregar esta lixeira. Tente novamente.' }) }
})

googleTrashRouter.patch('/:accountId/:fileId', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ action: z.enum(['restore', 'delete']) }).parse(req.body)
    res.json(await changeGoogleTrash(req.user!.id, accountId.parse(req.params.accountId), fileId.parse(req.params.fileId), body.action))
  } catch (error) { res.status(400).json({ code: 'GOOGLE_TRASH_ACTION_FAILED', message: message(error) }) }
})