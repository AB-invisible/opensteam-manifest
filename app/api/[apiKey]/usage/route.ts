import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders } from '@/app/lib/auth'

/**
 * GET /api/[apiKey]/usage
 * 
 * Detailed usage tracking for a specific API key.
 * Shows total usage, daily limits, and breakdown by endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { apiKey: string } }
) {
  const { apiKey } = params

  // 1. Auth (Skipping usage tracking for usage monitoring)
  const auth = await authenticateApiKey(request, { providedKey: apiKey, skipUsage: true })
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) })
  }

  try {
    // 2. Fetch usage breakdown for this specific key
    const usageByEndpoint = await prisma.apiUsage.groupBy({
      by: ['endpoint'],
      where: { apiKeyId: auth.apiKeyId },
      _count: { endpoint: true }
    })

    const endpointBreakdown = usageByEndpoint.reduce((acc: Record<string, number>, curr: { endpoint: string; _count: { endpoint: number } }) => {
      acc[curr.endpoint] = curr._count.endpoint
      return acc
    }, {} as Record<string, number>)

    const totalRequests = await prisma.apiUsage.count({
      where: { apiKeyId: auth.apiKeyId }
    })

    // 3. Daily usage derived from auth.dailyQuota (single source of truth)
    const todayUsage = Math.max(0, auth.dailyQuota.limit - auth.dailyQuota.remaining)

    return NextResponse.json({
      success: true,
      data: {
        totalRequests,
        todayUsage,
        dailyLimit: auth.dailyQuota.limit,
        remaining: auth.dailyQuota.remaining,
        endpointBreakdown
      },
      rateLimit: {
        remaining: auth.rateLimit.remaining,
        limit: auth.rateLimit.limit,
        resetAt: auth.rateLimit.resetAt
      }
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })

  } catch (error) {
    console.error(`[/api/[apiKey]/usage] Error:`, error)
    return NextResponse.json({ error: 'Failed to process usage data.' }, { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  }
}
