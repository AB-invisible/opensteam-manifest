import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey } from '@/app/lib/auth'
import { checkDailyApiQuota } from '@/app/lib/ratelimit'
import { getApiDailyLimit } from '@/app/lib/config'
import { Plan } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/sessions
 * 
 * Returns all tracked client sessions with filtering and real-time usage stats.
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url)
    const onlineOnly = searchParams.get('online') === 'true'
    const roleFilter = searchParams.get('role')
    const query = searchParams.get('q')

    const now = new Date()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)

    // Build filter
    const where: any = {}

    if (onlineOnly) {
      where.lastSeen = { gte: tenMinutesAgo }
    }

    if (roleFilter) {
      where.user = { role: roleFilter }
    }

    if (query) {
      where.OR = [
        { user: { username: { contains: query, mode: 'insensitive' } } },
        { user: { discordId: { contains: query, mode: 'insensitive' } } },
        { id: { contains: query, mode: 'insensitive' } }
      ]
    }

    // Execute queries
    const [total, onlineCount, sessions] = await Promise.all([
      prisma.appSession.count(),
      prisma.appSession.count({ where: { lastSeen: { gte: tenMinutesAgo } } }),
      prisma.appSession.findMany({
        where,
        include: {
          user: true,
          apiKey: true,
          events: {
            orderBy: { timestamp: 'desc' },
            take: 1
          }
        },
        orderBy: { lastSeen: 'desc' }
      })
    ])

    // Format response with real-time usage
    const formattedSessions = await Promise.all(sessions.map(async (s) => {
      const lastEvent = s.events[0] || null
      
      // Calculate usage for this key
      const dailyLimit = getApiDailyLimit({ ...s.user, plan: s.user.plan as Plan })
      const quota = await checkDailyApiQuota(s.userId, dailyLimit, { enforce: false })

      return {
        sessionId: s.id,
        apiKey: s.apiKey.key,
        appVersion: s.appVersion,
        online: s.lastSeen >= tenMinutesAgo,
        lastSeen: s.lastSeen.toISOString(),
        user: {
          discordId: s.user.discordId,
          username: s.user.username,
          role: s.user.role,
          isStaff: s.user.role !== 'USER'
        },
        plan: s.user.plan,
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
          disable: s.apiKey.adminDisable,
          forceUpdate: s.apiKey.adminForceUpdate
        }
      }
    }))

    return NextResponse.json({
      total,
      online: onlineCount,
      sessions: formattedSessions
    })

  } catch (error) {
    console.error('[/api/admin/sessions] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
