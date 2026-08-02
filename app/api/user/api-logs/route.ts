import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { getApiUsageTimeSeries } from '@/app/lib/api-usage-series'
import { isModeratorPlus } from '@/app/lib/staff-roles'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/api-logs
 *
 * Staff only: same roles as dashboard “Moderator+” (Trial Moderator through Owner).
 * Includes: IP, user agent, endpoint, method, status, timestamps, requested app info.
 * Supports pagination via `page` and `limit` query params.
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

    if (!isModeratorPlus(user.role)) {
      return NextResponse.json(
        { error: 'API Logs are only visible to staff (Trial Moderator and above).' },
        { status: 403, headers }
      )
    }

    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')))
    const skip = (page - 1) * limit

    // Get user's API keys
    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, key: true }
    })

    const keyIds = apiKeys.map((k: { id: string }) => k.id)

    if (keyIds.length === 0) {
      return NextResponse.json({
        logs: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        summary: {
          totalRequests: 0,
          uniqueIPs: 0,
          uniqueUserAgents: 0,
          successRate: 0,
          todayRequests: 0,
        },
        charts: { daily: [], weekly: [], monthly: [] },
        limitsExplainer: {
          velocity:
            'Rate limiting (burst + hourly) caps how many requests you can make per minute and per hour — it smooths traffic and prevents abuse.',
          dailyQuota:
            'Daily usage is your plan’s cap on successful API generations per UTC calendar day (total across your keys).',
        },
      }, { headers })
    }

    const [logs, total, charts] = await Promise.all([
      prisma.apiUsage.findMany({
        where: { apiKeyId: { in: keyIds } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          apiKey: {
            select: { name: true, key: true }
          }
        }
      }),
      prisma.apiUsage.count({
        where: { apiKeyId: { in: keyIds } },
      }),
      getApiUsageTimeSeries(keyIds),
    ])

    // Summary stats
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const [todayRequests, allLogs] = await Promise.all([
      prisma.apiUsage.count({
        where: {
          apiKeyId: { in: keyIds },
          createdAt: { gte: todayStart }
        }
      }),
      prisma.apiUsage.findMany({
        where: { apiKeyId: { in: keyIds } },
        select: { ip: true, userAgent: true, status: true }
      })
    ])

    const uniqueIPs = new Set(allLogs.map((l: { ip: string | null }) => l.ip).filter(Boolean)).size
    const uniqueUserAgents = new Set(allLogs.map((l: { userAgent: string | null }) => l.userAgent).filter(Boolean)).size
    const successCount = allLogs.filter((l: { status: number }) => l.status >= 200 && l.status < 400).length
    const successRate = allLogs.length > 0 ? Math.round((successCount / allLogs.length) * 100) : 0

    // Mask API keys in response (show only first 8 + last 4 chars)
    const maskedLogs = logs.map((log: any) => ({
      ...log,
      apiKey: {
        name: log.apiKey.name,
        key: log.apiKey.key.substring(0, 8) + '...' + log.apiKey.key.slice(-4)
      }
    }))

    return NextResponse.json({
      logs: maskedLogs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalRequests: total,
        uniqueIPs,
        uniqueUserAgents,
        successRate,
        todayRequests,
      },
      charts,
      limitsExplainer: {
        velocity:
          'Rate limiting (burst + hourly) caps how many requests you can make per minute and per hour — it smooths traffic and prevents abuse.',
        dailyQuota:
          'Daily usage is your plan’s cap on successful API generations per UTC calendar day (total across your keys).',
      },
    }, { headers })
  } catch (error) {
    console.error('Error fetching API logs:', error)
    return NextResponse.json({ error: 'Failed to fetch API logs' }, { status: 500, headers })
  }
}
