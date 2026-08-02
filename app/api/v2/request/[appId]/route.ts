import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'
import { sendWebhook } from '@/app/lib/webhooks'
import { validateSteamBaseGameAppId } from '@/app/lib/steam-app-validation'
import { findGameAlreadyInDatabase, gameAlreadyInDatabaseMessage } from '@/app/lib/game-request-validation'

/**
 * GET/POST /api/v2/request/[appId]
 * 
 * Formal "Request Game" programmatic endpoint.
 * This is for users to specifically request that a game be added to the platform
 * if it's currently unavailable or if they want to suggest improvements.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const { appId  } = params

  // 1. Auth
  const auth = await authenticateApiKey(request)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) })
  }

  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  // 2. Validate Steam appId (must exist and be base game)
  const validated = await validateSteamBaseGameAppId(appId)
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: validated.status, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

  try {
    const { reason } = await request.json().catch(() => ({ reason: 'API Request' }))

    const gameName = validated.name

    const existingGame = await findGameAlreadyInDatabase(validated.appId, gameName)
    if (existingGame) {
      return NextResponse.json(
        { status: 'not sent', error: gameAlreadyInDatabaseMessage(existingGame) },
        { status: 409, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    // Create request record
    const gameRequest = await prisma.gameRequest.create({
      data: {
        name: gameName,
        appId: String(appId),
        reason: reason || 'Requested via API',
        userId: auth.user.id
      }
    })

    // Trigger Discord Request Management
    import('@/app/lib/discord-requests').then(m => {
      m.sendDiscordGameRequest(gameRequest.id).catch(() => {})
    })

    // Notify via Webhook
    sendWebhook('GAME_REQUEST', {
      username: auth.user.username,
      userId: auth.user.id,
      gameName: gameName,
      appId: String(appId),
      reason: reason || 'API'
    }).catch(() => {})

    return NextResponse.json({
      status: 'sent',
      appId: String(appId),
      gameName: gameName
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })

  } catch (error) {
    console.error(`[/api/v2/request/${appId}]`, error)
    return NextResponse.json({ 
      status: 'not sent', 
      error: 'Failed to process request.' 
    }, { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  }
}
