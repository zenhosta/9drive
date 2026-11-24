import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { getBalance, previewBalance, startBalance, pauseBalance, endBalance } from './rebalance.service.js'

export const rebalanceRouter = Router()
rebalanceRouter.use(requireAuth)
rebalanceRouter.get('/', async (req: AuthRequest, res, next) => {
  try { res.json({ job: await getBalance(req.user!.id) }) } catch (error) { next(error) }
})
rebalanceRouter.post('/preview', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ scope: z.enum(['managed', 'all']).default('managed') }).parse(req.body)
    res.json({ job: await previewBalance(req.user!.id, body.scope) })
  } catch (error) {
    const message = error instanceof Error && error.name === 'BalanceError' ? error.message : 'Não foi possível analisar as contas. Confira a conexão e as permissões do Google Drive.'
    res.status(400).json({ code: 'REBALANCE_PREVIEW_FAILED', message })
  }
})
rebalanceRouter.post('/:id/start', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ selectedMoveIds: z.array(z.string()).optional(), deleteOriginals: z.boolean().optional() }).parse(req.body)
    res.json({ job: await startBalance(req.user!.id, req.params.id, body.selectedMoveIds, body.deleteOriginals) })
  } catch (error) {
    const message = error instanceof Error && error.name === 'BalanceError' ? error.message : 'Não foi possível iniciar a redistribuição.'
    res.status(400).json({ code: 'REBALANCE_START_FAILED', message })
  }
})
rebalanceRouter.post('/:id/pause', async (req: AuthRequest, res) => {
  try { res.json({ job: await pauseBalance(req.user!.id, req.params.id) }) } catch { res.status(500).json({ code: 'REBALANCE_PAUSE_FAILED', message: 'Não foi possível pausar.' }) }
})
rebalanceRouter.post('/:id/end', async (req: AuthRequest, res) => {
  try { res.json({ job: await endBalance(req.user!.id, req.params.id) }) } catch { res.status(500).json({ code: 'REBALANCE_END_FAILED', message: 'Não foi possível encerrar.' }) }
})