import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse, legacyCutoffResponse } from '@/app/lib/auth'
import { getDiscordAccessTokenForApi } from '@/app/lib/discord-oauth-tokens'

/**
 * POST /api/[apiKey]/activate
 * 
 * Activates the Windows application using the provided API key.
 * Stores machine metadata to track installations.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { apiKey: string } }
) {
  const { apiKey } = params

  // 1. Authenticate API Key (Skipping usage tracking for activation)
  const auth = await authenticateApiKey(request, { providedKey: apiKey, skipUsage: true })
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid API key.' }, 
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }

  const cutoffDate = new Date('2026-07-05T00:00:00.000Z')
  if (new Date(auth.apiKey.createdAt) >= cutoffDate) {
    return legacyCutoffResponse(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin'))
  }

  // 2. Check if activations are globally enabled for this key
  if (!auth.apiKey.activationsEnabled) {
    return NextResponse.json(
      { error: 'Windows app activations are disabled for this API key.' },
      { status: 403, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

  // 3. Check Plan Quotas
  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  try {
    // 4. Extract Metadata
    const body = await request.json().catch(() => ({}))
    const { machineId, os, version } = body

    // 5. Determine if this is a first-time activation for this key (across all machines)
    const totalExistingCount = await prisma.appActivation.count({
      where: { apiKeyId: auth.apiKeyId }
    })
    const isFirstActivationAcrossKey = totalExistingCount === 0

    // 6. Check for existing activation for THIS specific machine
    let activation = machineId ? await prisma.appActivation.findFirst({
      where: { apiKeyId: auth.apiKeyId, machineId: String(machineId) }
    }) : null

    // 7. Enforce machine-level status
    if (activation && (!activation.enabled || activation.status !== 'ACTIVE')) {
      return NextResponse.json(
        { 
          error: 'This machine activation has been disabled or revoked.', 
          status: activation.status,
          enabled: activation.enabled
        },
        { status: 403, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    // 8. Record/Update Activation
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    
    if (activation) {
      activation = await prisma.appActivation.update({
        where: { id: activation.id },
        data: {
          os: os ? String(os) : activation.os,
          version: version ? String(version) : activation.version,
          ip,
          // Stay enabled/active if we're just updating
        }
      })
    } else {
      activation = await prisma.appActivation.create({
        data: {
          apiKeyId: auth.apiKeyId,
          machineId: machineId ? String(machineId) : null,
          os: os ? String(os) : 'Windows',
          version: version ? String(version) : 'unknown',
          ip,
          isFirstActivation: isFirstActivationAcrossKey
        }
      })
    }

    // 9. Success Response
    const discordAccessToken = await getDiscordAccessTokenForApi({
      discordId: auth.user.discordId,
      discordAccessToken: auth.user.discordAccessToken,
      discordRefreshToken: auth.user.discordRefreshToken,
    })

    return NextResponse.json({
      success: true,
      data: {
        activationId: activation.id,
        isNewUser: isFirstActivationAcrossKey,
        user: {
          username: auth.user.username,
          plan: auth.user.plan,
          role: auth.user.role,
          isStaff: auth.user.role !== 'USER',
          discordId: auth.user.discordId,
          ...(discordAccessToken ? { discordAccessToken } : {}),
        }
      },
      usage: {
        today: Math.max(0, auth.dailyQuota.limit - auth.dailyQuota.remaining),
        limit: auth.dailyQuota.limit,
        remaining: auth.dailyQuota.remaining,
        resetAt: auth.dailyQuota.resetAt
      }
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })

  } catch (error) {
    console.error('[/api/[apiKey]/activate] error:', error)
    return NextResponse.json(
      { error: 'Internal server error during activation.' }, 
      { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }
}
