import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey, apiHeaders } from '@/app/lib/auth'
import { getDiscordAccessTokenForApi } from '@/app/lib/discord-oauth-tokens'
import { countDailyBillableGenerations } from '@/app/lib/ratelimit'

/**
 * GET /api/v2/stats
 *
 * Bearer-authenticated stats for the OpenSteam desktop app.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, { skipUsage: true })
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid API key.' },
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }

  try {
    const todayUsage = await countDailyBillableGenerations(auth.user.id)
    const remaining = Math.max(0, auth.dailyQuota.limit - todayUsage)
    const dailyQuota = { ...auth.dailyQuota, remaining }
    const discordAccessToken = await getDiscordAccessTokenForApi({
      discordId: auth.user.discordId,
      discordAccessToken: auth.user.discordAccessToken,
      discordRefreshToken: auth.user.discordRefreshToken,
    })

    return NextResponse.json(
      {
        success: true,
        plan: auth.user.plan,
        user: {
          discordId: auth.user.discordId,
          username: auth.user.username,
          discriminator: auth.user.discriminator,
          role: auth.user.role,
          isStaff: auth.user.role !== 'USER',
          ...(discordAccessToken ? { discordAccessToken } : {}),
        },
        usage: {
          today: todayUsage,
          limit: auth.dailyQuota.limit,
          remaining,
          resetAt: auth.dailyQuota.resetAt,
        },
        rateLimit: {
          remaining: auth.rateLimit.remaining,
          limit: auth.rateLimit.limit,
          resetAt: auth.rateLimit.resetAt,
        },
      },
      { headers: apiHeaders(auth.rateLimit, dailyQuota, request.headers.get('Origin')) }
    )
  } catch (error) {
    console.error('[/api/v2/stats]', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats.' },
      { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }
}
