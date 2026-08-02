import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/overview
 * 
 * Returns aggregate statistics for the admin dashboard.
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

    const now = new Date()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)
    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)

    const [
      totalSessions,
      onlineSessions,
      disabledKeys,
      pendingForceUpdate,
      eventsToday
    ] = await Promise.all([
      prisma.appSession.count(),
      prisma.appSession.count({ where: { lastSeen: { gte: tenMinutesAgo } } }),
      prisma.apiKey.count({ where: { adminDisable: true } }),
      prisma.apiKey.count({ where: { adminForceUpdate: true } }),
      prisma.appEvent.groupBy({
        by: ['type'],
        where: { timestamp: { gte: todayStart } },
        _count: { _all: true }
      })
    ])

    // Format event counts
    const eventCountsToday: Record<string, number> = {
      startup: 0,
      install: 0,
      remove: 0,
      search: 0,
      heartbeat: 0
    }

    eventsToday.forEach(e => {
      if (e.type in eventCountsToday) {
        eventCountsToday[e.type] = Number(e._count._all)
      }
    })

    return NextResponse.json({
      totalSessions,
      onlineSessions,
      disabledKeys,
      pendingForceUpdate,
      eventCountsToday
    })

  } catch (error) {
    console.error('[/api/admin/overview] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
