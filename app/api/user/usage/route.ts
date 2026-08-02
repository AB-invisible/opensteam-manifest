import { authOptions } from '@/app/lib/auth-options'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { getApiDailyLimit, getApiBurstLimit } from '@/app/lib/config'
import { getApiUsageTimeSeries } from '@/app/lib/api-usage-series'
import { isModeratorPlus } from '@/app/lib/staff-roles'

/**
 * GET /api/user/usage
 *
 * Includes `charts` (API time series) only for Moderator+ staff roles.
 */
export const dynamic = 'force-dynamic'

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

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: { id: true }
    })

    // Fetch total usage count across all keys
    const totalRequests = await prisma.apiUsage.count({
      where: { apiKeyId: { in: apiKeys.map((k: { id: string }) => k.id) } }
    })

    // Group usage by endpoint
    const endpointUsageList = await prisma.apiUsage.groupBy({
      by: ['endpoint'],
      where: { apiKeyId: { in: apiKeys.map((k: { id: string }) => k.id) } },
      _count: { endpoint: true }
    })

    const endpointUsage = endpointUsageList.reduce((acc: Record<string, number>, curr: { endpoint: string; _count: { endpoint: number } }) => {
      acc[curr.endpoint] = curr._count.endpoint;
      return acc;
    }, {} as Record<string, number>);

    // Fetch today's API usage count across all keys
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setUTCHours(23, 59, 59, 999)

    const todayApiRequests = await prisma.apiUsage.count({
      where: {
        apiKeyId: { in: apiKeys.map((k: { id: string }) => k.id) },
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: { in: [200, 201] },
      },
    })

    const apiDailyLimit = getApiDailyLimit(user)
    const apiMinuteLimit = getApiBurstLimit(user)

    const keyIds = apiKeys.map((k: { id: string }) => k.id)
    const payload: Record<string, unknown> = {
      totalRequests,
      todayRequests: todayApiRequests,
      endpointUsage,
      apiDailyLimit,
      apiMinuteLimit,
    }
    if (isModeratorPlus(user.role)) {
      const charts =
        keyIds.length > 0
          ? await getApiUsageTimeSeries(keyIds)
          : { daily: [], weekly: [], monthly: [] }
      payload.charts = charts
    }

    return NextResponse.json(payload, { headers })
  } catch (error) {
    console.error('Error fetching usage stats:', error)
    return NextResponse.json({ error: 'Failed to fetch usage stats' }, { status: 500, headers })
  }
}
