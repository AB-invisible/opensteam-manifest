import { authOptions } from '@/app/lib/auth-options'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { getWebDailyLimit, getApiDailyLimit } from '@/app/lib/config'
import { sumApiQuotaRemainingAcrossKeys } from '@/app/lib/ratelimit'
import { getWebGenerationTimeSeries } from '@/app/lib/web-generation-series'
import { isModeratorPlus } from '@/app/lib/staff-roles'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/generations
 * 
 * Chart series (`charts`) is included only for Moderator+ (staff) roles.
 * Used by the status bar to show free users how many manifests they've generated today.
 */
export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404, headers })
    }

    // Get today's date range (UTC)
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setUTCHours(23, 59, 59, 999)

    const todayCount = await prisma.webGeneration.count({
      where: {
        userId: user.id,
        source: { notIn: ['discord-hosted', 'discord-hosted-api'] },
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        }
      }
    })

    // Get recent generations (last 10)
    const recentGenerations = await prisma.webGeneration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        appId: true,
        gameName: true,
        isNsfw: true,
        createdAt: true,
      }
    })

    const dailyLimit = getWebDailyLimit(user)
    const apiDailyLimitPerKey = getApiDailyLimit(user)
    const { totalRemaining: apiQuotaRemaining, keyCount } = await sumApiQuotaRemainingAcrossKeys(
      user.id,
      user
    )

    return NextResponse.json(
      {
        todayCount,
        dailyLimit,
        plan: user.plan,
        recentGenerations,
        apiDailyLimitPerKey,
        apiQuotaRemaining,
        hasEnabledApiKey: keyCount > 0,
        ...(isModeratorPlus(user.role)
          ? { charts: await getWebGenerationTimeSeries(user.id) }
          : {}),
      },
      { headers }
    )
  } catch (error) {
    console.error('Error fetching generation stats:', error)
    return NextResponse.json({ error: 'Failed to fetch generation stats' }, { status: 500, headers })
  }
}
