import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey, apiHeaders } from '@/app/lib/auth'
import { getDiscordAccessTokenForApi } from '@/app/lib/discord-oauth-tokens'

/**
 * GET /api/[apiKey]/stats
 * 
 * Returns usage statistics and limits for the provided API key.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { apiKey: string } }
) {
  const { apiKey } = params

  // 1. Auth (Skipping usage tracking for stats monitoring)
  const auth = await authenticateApiKey(request, { providedKey: apiKey, skipUsage: true })
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) })
  }

  try {
    const todayUsage = Math.max(0, auth.dailyQuota.limit - auth.dailyQuota.remaining)
    const discordAccessToken = await getDiscordAccessTokenForApi({
      discordId: auth.user.discordId,
      discordAccessToken: auth.user.discordAccessToken,
      discordRefreshToken: auth.user.discordRefreshToken,
    })

    return NextResponse.json({
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
        remaining: auth.dailyQuota.remaining,
        resetAt: auth.dailyQuota.resetAt
      },
      rateLimit: {
        remaining: auth.rateLimit.remaining,
        limit: auth.rateLimit.limit,
        resetAt: auth.rateLimit.resetAt
      }
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })

  } catch (error) {
    console.error(`[/api/[apiKey]/stats]`, error)
    return NextResponse.json({ error: 'Failed to fetch stats.' }, { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  }
}
