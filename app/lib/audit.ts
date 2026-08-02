import { prisma } from './prisma'

/**
 * Logs an administrative action to the database.
 */
export async function createAuditLog(
  performerId: string, 
  action: string, 
  targetId?: string, 
  details?: string, 
  ip?: string
) {
  try {
    await (prisma as any).auditLog.create({
      data: {
        userId: performerId,
        action,
        targetId,
        details,
        ip
      }
    })
  } catch (error) {
    console.error('Failed to create audit log:', error)
  }
}
