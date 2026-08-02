import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey } from '@/app/lib/auth'
import { checkDailyApiQuota } from '@/app/lib/ratelimit'
import { getApiDailyLimit } from '@/app/lib/config'
import { Plan } from '@prisma/client'

/**
 * GET /api/admin/sessions/[sessionId]
 * 
 * Returns details for a single session.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params

    // 1. Authenticate (Session or API Key)
    let user = null
    const auth = await authenticateApiKey(request, { skipUsage: true })
    
    if (auth) {
      user = auth.user
    } else {
      const { getServerSession } = await import('next-auth')
      const { authOptions } = await import('@/app/lib/auth-options')
      const session = await getServerSession(authOptions)
      if (session?.user) {
        user = await prisma.user.findUnique({
          where: { discordId: session.user.discordId as string }
        })
      }
    }

    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 2. Fetch Session
    const session = await prisma.appSession.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
        apiKey: true,
        events: {
          orderBy: { timestamp: 'desc' },
          take: 1
        }
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const now = new Date()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)
    const lastEvent = session.events[0] || null

    // Calculate usage
    const dailyLimit = getApiDailyLimit({ ...session.user, plan: session.user.plan as Plan })
    const quota = await checkDailyApiQuota(session.userId, dailyLimit, { enforce: false })

    return NextResponse.json({
      sessionId: session.id,
      apiKey: session.apiKey.key,
      appVersion: session.appVersion,
      online: session.lastSeen >= tenMinutesAgo,
      lastSeen: session.lastSeen.toISOString(),
      user: {
        discordId: session.user.discordId,
        username: session.user.username,
        role: session.user.role,
        isStaff: session.user.role !== 'USER'
      },
      plan: session.user.plan,
      usage: {
        today: Math.max(0, quota.limit - quota.remaining),
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt
      },
      lastEvent: lastEvent ? {
        type: lastEvent.type,
        appId: lastEvent.appId,
        gameName: lastEvent.gameName,
        success: lastEvent.success,
        detail: lastEvent.detail,
        timestamp: lastEvent.timestamp.toISOString()
      } : null,
      commands: {
        disable: session.apiKey.adminDisable,
        forceUpdate: session.apiKey.adminForceUpdate
      }
    })

  } catch (error) {
    console.error('[/api/admin/sessions/[sessionId]] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
