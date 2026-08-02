import { authOptions } from '@/app/lib/auth-options'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { getDiscordCdnAvatarUrl } from '@/app/lib/discord-avatar'
import { syncUserDiscordProfileFromApi } from '@/app/lib/discord-profile-sync'

export const dynamic = 'force-dynamic'

/**
 * POST /api/user/refresh-avatar
 *
 * Pulls the user's current Discord profile from /users/@me using the stored
 * OAuth token, then updates username and avatar in the DB when they changed.
 */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const session = await getServerSession(authOptions)
    if (!session || !(session.user as any)?.discordId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }
    const discordId = (session.user as any).discordId as string

    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        username: true,
        avatar: true,
        discordId: true,
        discordAccessToken: true,
        discordRefreshToken: true,
      } as any
    }) as any

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404, headers })
    }

    const result = await syncUserDiscordProfileFromApi(user)

    if (result.reason === 'no-token') {
      const fallbackAvatar = getDiscordCdnAvatarUrl(user.discordId, null, 128)
      return NextResponse.json(
        {
          success: false,
          reason: 'no-token',
          avatar: fallbackAvatar,
          changed: false,
          message: 'No Discord access token on file. Using default avatar.',
        },
        { status: 200, headers }
      )
    }

    if (result.reason === 'token-expired') {
      const fallbackAvatar = getDiscordCdnAvatarUrl(user.discordId, null, 128)
      return NextResponse.json(
        {
          success: false,
          reason: 'token-expired',
          avatar: fallbackAvatar,
          changed: false,
          message: 'Discord token expired. Using default avatar until you sign in again.',
        },
        { status: 200, headers }
      )
    }

    if (result.reason === 'api-error') {
      return NextResponse.json(
        { error: 'Discord API unreachable' },
        { status: 502, headers }
      )
    }

    return NextResponse.json({
      success: true,
      avatar: result.avatar,
      username: result.username,
      changed: result.changed,
    }, { headers })

  } catch (error: any) {
    console.error('[refresh-avatar]', error)
    return NextResponse.json(
      { error: 'Failed to refresh avatar', detail: error?.message },
      { status: 500, headers }
    )
  }
}
