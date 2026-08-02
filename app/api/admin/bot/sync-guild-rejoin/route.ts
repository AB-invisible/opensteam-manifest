import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { verifyDiscordBotRequest } from '@/app/lib/discord-bot-auth'
import { writeVerificationAudit } from '@/app/lib/discord-verify-session'

/**
 * Called by the bot when a user rejoins the guild AND gains the verified role.
 * Restores API keys that were auto-suspended on guild leave.
 */
export async function POST(request: NextRequest) {
  if (!(await verifyDiscordBotRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { discordId, verified } = await request.json().catch(() => ({}))
  if (!discordId) {
    return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: String(discordId) },
    select: { id: true, role: true },
  })

  if (!user) {
    return NextResponse.json({ success: true, message: 'User not registered in OpenSteam.' })
  }

  // Mark user as active again
  await (prisma.user as any).update({
    where: { id: user.id },
    data: {
      discordMemberStatus: 'active',
      discordLeftAt: null,
      ...(verified ? { discordVerifiedAt: new Date() } : {}),
    },
  })

  // Only restore keys if they verified (or if user was never suspended)
  let restoredKeys = 0
  if (verified) {
    const result = await (prisma.apiKey as any).updateMany({
      where: {
        userId: user.id,
        suspendedByLeave: true,
      },
      data: {
        enabled: true,
        suspendedByLeave: false,
      },
    })
    restoredKeys = result.count
  }

  await writeVerificationAudit({
    discordId: String(discordId),
    action: verified ? 'GUILD_REJOIN_VERIFIED_RESTORED' : 'GUILD_REJOIN_PENDING_VERIFY',
    details: {
      userId: user.id,
      apiKeysRestored: restoredKeys,
      verified: !!verified,
    },
  }).catch((err: Error) => console.error('[sync-guild-rejoin] audit error:', err))

  console.log(`[GuildRejoin] ${discordId} rejoined — verified=${!!verified}, ${restoredKeys} API key(s) restored`)

  return NextResponse.json({ success: true, verified: !!verified, apiKeysRestored: restoredKeys })
}
