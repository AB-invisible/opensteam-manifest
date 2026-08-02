import { prisma } from './prisma'
import { revokeWebSessionForGuildBan } from './web-session-revoke'

export function isDiscordGuildRestricted(user: {
  discordGuildBannedAt?: Date | null
  discordMemberStatus?: string | null
  role?: string
}): boolean {
  if (Boolean(user.discordGuildBannedAt)) return true
  if (user.discordMemberStatus === 'left' && !['ADMIN', 'OWNER'].includes(user.role ?? '')) return true
  return false
}

export function assertDiscordGuildAccess(user: {
  discordGuildBannedAt?: Date | null
  discordMemberStatus?: string | null
  role?: string
}): { ok: true } | { ok: false; error: string; code: 'DISCORD_GUILD_BANNED' | 'DISCORD_GUILD_LEFT' } {
  if (Boolean(user.discordGuildBannedAt)) {
    return {
      ok: false,
      error:
        'Your OpenSteam access is restricted because you were banned from our Discord server. API keys, generation, and game requests are disabled until the ban is lifted.',
      code: 'DISCORD_GUILD_BANNED',
    }
  }
  if (user.discordMemberStatus === 'left' && !['ADMIN', 'OWNER'].includes(user.role ?? '')) {
    return {
      ok: false,
      error:
        'Your OpenSteam account is suspended because you left our Discord server. Please rejoin at opensteam.lol/discord and complete verification to restore your access.',
      code: 'DISCORD_GUILD_LEFT',
    }
  }
  return { ok: true }
}

/** Guild ban sync: log out + restrict services without marking isBanned. */
export async function applyDiscordGuildBanRestrictions(
  userId: string,
  discordId: string,
  reason?: string
): Promise<void> {
  await revokeWebSessionForGuildBan(discordId)

  await prisma.user.update({
    where: { id: userId },
    data: { discordGuildBannedAt: new Date() },
  })

  await prisma.apiKey.updateMany({
    where: { userId },
    data: { enabled: false, adminDisable: true },
  })

  await prisma.sentinelLog.create({
    data: {
      userId,
      action: 'AUTO_JAIL',
      score: 100,
      reason: `Discord Guild Ban: ${reason || 'No reason provided'}`,
      details: JSON.stringify({ source: 'sync-ban', event: 'guild-ban-restrict' }),
    },
  })
}

/** Lift guild-ban restrictions when the user is unbanned on Discord. */
export async function liftDiscordGuildBanRestrictions(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { discordGuildBannedAt: true, isBanned: true },
  })
  if (!user?.discordGuildBannedAt) return false

  await prisma.user.update({
    where: { id: userId },
    data: { discordGuildBannedAt: null },
  })

  if (!user.isBanned) {
    await prisma.apiKey.updateMany({
      where: { userId, adminDisable: true },
      data: { enabled: true, adminDisable: false },
    })
  }

  return true
}
