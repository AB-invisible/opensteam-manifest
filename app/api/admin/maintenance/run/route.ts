import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { MaintenanceEngine } from '@/app/lib/maintenance'
import { ScalingEngine } from '@/app/lib/scaling'
import { countPlaceholderManifests } from '@/app/lib/platform-health'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/maintenance/run
 * Orchestrates autonomous system tasks (scaling checks + data hygiene).
 * Gated by ADMIN role. Can be triggered by cron or manual administrative action.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  // Auth requirement: Must be ADMIN to trigger autonomy orchestration
  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  console.log('[Autonomy] Triggering orchestrated maintenance run...')

  try {
    // 1. Run Scaling Check
    const scalingResult = await ScalingEngine.monitorVelocity()

    // 2. Perform General Health Check
    const healthResult = await MaintenanceEngine.performHealthCheck()

    const placeholderManifestCount = await countPlaceholderManifests()

    // 3. Clean up expired manifest drop cooldowns (older than 7 days)
    let expiredDropsCleaned = 0
    try {
      const { cleanupExpiredDrops } = await import('@/app/lib/bot-admin')
      expiredDropsCleaned = await cleanupExpiredDrops()
    } catch (_) {}

    // Log the successful run
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'MAINTENANCE_RUN',
        details: `Autonomy run completed: healthy: ${healthResult.healthy}, placeholder names: ${placeholderManifestCount}, Scaling required: ${scalingResult.scalingRequired}, Drop cooldowns cleaned: ${expiredDropsCleaned}`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({
      success: true,
      results: {
        scaling: scalingResult,
        health: healthResult,
        placeholderManifestCount,
        expiredDropsCleaned,
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('[Autonomy Run Error]', error)
    return NextResponse.json({ 
      error: 'Autonomous orchestration failed internally.' 
    }, { status: 500 })
  }
}
