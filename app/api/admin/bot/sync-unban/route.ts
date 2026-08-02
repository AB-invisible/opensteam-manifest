import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { liftDiscordGuildBanRestrictions } from '@/app/lib/discord-guild-restrictions'
import { verifyBearerSecret } from '@/app/lib/bearer-auth'
import { getRuntimeSecret } from '@/app/lib/runtime-secrets'

export async function POST(request: NextRequest) {
  try {
    const secret = await getRuntimeSecret('DISCORD_BOT_TOKEN')

    if (!secret || !verifyBearerSecret(request.headers.get('authorization'), secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { discordId, userId, reason } = await request.json()
    if (!discordId && !userId) {
      return NextResponse.json({ error: 'Missing discordId or userId' }, { status: 400 })
    }

    let user
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } })
    } else if (discordId) {
      user = await prisma.user.findUnique({ where: { discordId } })
    }

    if (!user) {
      return NextResponse.json({ success: true, message: 'User not found in OpenSteam database.' })
    }

    const lifted = await liftDiscordGuildBanRestrictions(user.id)

    if (lifted) {
      await prisma.sentinelLog.create({
        data: {
          userId: user.id,
          action: 'AUTO_UNJAIL',
          score: 0,
          reason: `Discord Unban: ${reason || 'No reason provided'}`,
          details: JSON.stringify({ source: 'DiscordBotDaemon', event: 'sync-unban' }),
        },
      })

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'UNBAN_USER',
          targetId: user.id,
          details: `Discord guild-ban restrictions lifted. Reason: ${reason || 'Discord Guild Unban Synchronized'}`,
          ip: 'DiscordBot',
        },
      })

      const { sendBotDM } = await import('@/app/lib/bot-admin')
      const { sendBrandedEmail } = await import('@/app/lib/email')

      if (user.discordId) {
        await sendBotDM(user.discordId, '', {
          title: '🟢 OpenSteam Access Restored',
          description: `Your Discord guild ban was lifted. API keys, generation, and game requests are available again.\n\n**Reason:** ${reason || 'Discord Guild Unban'}`,
          color: 0x10b981,
          footer: { text: 'OpenSteam Network Security' },
        }).catch(() => {})
      }

      if (user.email) {
        await sendBrandedEmail(
          user.email,
          'OpenSteam Access Restored',
          '🟢 Discord Ban Lifted',
          `Your Discord guild ban was lifted and your OpenSteam API keys and generation access have been restored.<br><br><strong>Reason:</strong> ${reason || 'Discord Guild Unban'}`,
          '#10b981'
        ).catch(() => {})
      }
    }

    return NextResponse.json({
      success: true,
      lifted,
      message: lifted
        ? 'Guild-ban restrictions lifted and API keys re-enabled.'
        : 'No guild-ban restrictions were active.',
    })
  } catch (error: any) {
    console.error('[Bot Sync Unban Error]:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
