import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { verifyDiscordBotRequest } from '@/app/lib/discord-bot-auth'
import { hasEverUsedWebLogin, revokeWebSessionForGuildLeave } from '@/app/lib/web-session-revoke'
import { writeVerificationAudit } from '@/app/lib/discord-verify-session'

export async function POST(request: NextRequest) {
  if (!(await verifyDiscordBotRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { discordId } = await request.json().catch(() => ({}))
  if (!discordId) {
    return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: String(discordId) },
    select: {
      id: true,
      role: true,
      webLoginAt: true,
      discordVerifiedAt: true,
      discordAccessToken: true,
      discordRefreshToken: true,
      lastIp: true,
    },
  })

  if (!user) {
    return NextResponse.json({ success: true, message: 'User not registered in OpenSteam.' })
  }

  // Admins and owners are never suspended on guild leave
  if (['ADMIN', 'OWNER'].includes(user.role)) {
    return NextResponse.json({ success: true, revoked: false, message: 'Admin/Owner — no action taken.' })
  }

  // Mark user as left + pause all active API keys
  const [, pausedKeys] = await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data: {
        discordMemberStatus: 'left',
        discordLeftAt: new Date(),
      } as any,
    }),
    // Only pause keys that are currently enabled and not already admin-disabled
    prisma.apiKey.updateMany({
      where: {
        userId: user.id,
        enabled: true,
        adminDisable: false,
        suspendedByLeave: false,
      } as any,
      data: {
        enabled: false,
        suspendedByLeave: true,
      } as any,
    }),
  ])

  // Revoke web session
  let revoked = false
  if (hasEverUsedWebLogin(user)) {
    revoked = await revokeWebSessionForGuildLeave(String(discordId))
  }

  await writeVerificationAudit({
    discordId: String(discordId),
    action: 'GUILD_LEFT_ACCOUNT_SUSPENDED',
    details: {
      userId: user.id,
      webLoginAt: user.webLoginAt?.toISOString() ?? null,
      apiKeysPaused: pausedKeys.count,
      webSessionRevoked: revoked,
    },
  }).catch((err: Error) => console.error('[sync-guild-leave] audit error:', err))

  console.log(`[GuildLeave] ${discordId} left — status=left, ${pausedKeys.count} API key(s) paused, session revoked=${revoked}`)

  return NextResponse.json({ success: true, revoked, apiKeysPaused: pausedKeys.count })
}
