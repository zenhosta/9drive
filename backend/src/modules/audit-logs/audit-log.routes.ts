import { Router } from 'express'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'

export const auditLogRouter = Router()

auditLogRouter.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
    return res.json({ logs })
  } catch (error) {
    return next(error)
  }
})
