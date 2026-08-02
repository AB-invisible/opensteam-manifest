import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { applyDiscordGuildBanRestrictions } from '@/app/lib/discord-guild-restrictions'
import { revokeWebSessionForGuildBan } from '@/app/lib/web-session-revoke'
import { verifyBearerSecret } from '@/app/lib/bearer-auth'
import { getRuntimeSecret } from '@/app/lib/runtime-secrets'

export async function POST(request: NextRequest) {
  try {
    const secret = await getRuntimeSecret('DISCORD_BOT_TOKEN')

    if (!secret || !verifyBearerSecret(request.headers.get('authorization'), secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { discordId, reason } = await request.json()
    if (!discordId) return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { discordId } })
    if (!user) return NextResponse.json({ success: true, message: 'User not registered in OpenSteam.' })

    const firstRestriction = !user.discordGuildBannedAt
    if (firstRestriction) {
      await applyDiscordGuildBanRestrictions(user.id, user.discordId, reason)
    } else {
      await revokeWebSessionForGuildBan(user.discordId)
    }

    if (firstRestriction) {
      const { sendBotDM } = await import('@/app/lib/bot-admin')
      const { sendBrandedEmail } = await import('@/app/lib/email')

      if (user.discordId) {
        await sendBotDM(user.discordId, '', {
          title: '🚫 OpenSteam Access Restricted',
          description: `You were banned from our Discord server. Your web session was ended and API keys, generation, and game requests are disabled until the ban is lifted.\n\n**Reason:** ${reason || 'Discord Guild Ban'}`,
          color: 0xef4444,
          footer: { text: 'OpenSteam Network Security' },
        }).catch(() => {})
      }

      if (user.email) {
        await sendBrandedEmail(
          user.email,
          'OpenSteam Access Restricted',
          '🚫 Discord Ban — Access Restricted',
          `You were banned from our Discord server. Your OpenSteam web session was ended. You may sign in again, but API keys, manifest generation, and game requests stay disabled until the Discord ban is removed.<br><br><strong>Reason:</strong> ${reason || 'Discord Guild Ban'}`,
          '#ef4444'
        ).catch(() => {})
      }
    }

    return NextResponse.json({
      success: true,
      message: firstRestriction
        ? 'User logged out and guild-ban restrictions applied.'
        : 'User session revoked (guild-ban restrictions already active).',
    })
  } catch (error: any) {
    console.error('[Bot Sync Ban Error]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
