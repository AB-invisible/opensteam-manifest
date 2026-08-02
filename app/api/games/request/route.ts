import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { sendWebhook } from '@/app/lib/webhooks'
import { validateSteamBaseGameAppId } from '@/app/lib/steam-app-validation'
import { findGameAlreadyInDatabase, gameAlreadyInDatabaseMessage } from '@/app/lib/game-request-validation'
import { assertDiscordGuildAccess } from '@/app/lib/discord-guild-restrictions'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const { name, appId, reason } = await request.json()

    if (!appId || !String(appId).trim()) {
      return NextResponse.json({ error: 'Steam App ID is required.' }, { status: 400, headers })
    }

    const user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404, headers })
    }

    const guildAccess = assertDiscordGuildAccess(user)
    if (!guildAccess.ok) {
      return NextResponse.json({ error: guildAccess.error, code: guildAccess.code }, { status: 403, headers })
    }

    let normalizedName = name ? String(name).trim() : ''
    let normalizedAppId: string | null = String(appId).trim()

    if (normalizedAppId) {
      const validated = await validateSteamBaseGameAppId(normalizedAppId)
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: validated.status, headers })
      }
      normalizedAppId = validated.appId
      normalizedName = validated.name
    }

    const existingGame = await findGameAlreadyInDatabase(normalizedAppId, normalizedName)
    if (existingGame) {
      return NextResponse.json(
        { error: gameAlreadyInDatabaseMessage(existingGame) },
        { status: 409, headers }
      )
    }

    const newRequest = await prisma.gameRequest.create({
      data: {
        name: normalizedName,
        appId: normalizedAppId,
        reason: reason || null,
        userId: user.id
      }
    })

    // Trigger Discord Request Management
    import('@/app/lib/discord-requests').then(m => {
      m.sendDiscordGameRequest(newRequest.id).catch(() => {})
    })

    // Trigger Discord Webhook
    sendWebhook('GAME_REQUEST', {
      username: user.username,
      userId: user.id,
      gameName: normalizedName,
      appId: normalizedAppId || 'N/A',
      reason: reason || 'N/A'
    }).catch(() => {})

    return NextResponse.json({ success: true, request: newRequest }, { headers })
  } catch (error) {
    console.error('Error creating game request:', error)
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500, headers })
  }
}

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

    const requests = await prisma.gameRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20
    })

    return NextResponse.json({ requests }, { headers })
  } catch (error) {
    console.error('Error fetching requests:', error)
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500, headers })
  }
}
