import { prisma } from '../config/prisma.js'

export async function createAuditLog(userId: string, action: string, entityType: string, entityId?: string, metadata?: any) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
        metadata: metadata ? JSON.stringify(metadata) : undefined
      }
    })
  } catch (error) {
    console.error('Failed to create audit log:', error)
  }
}
