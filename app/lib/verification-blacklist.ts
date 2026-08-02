import { prisma } from '@/app/lib/prisma'

export type VerificationBlacklistHit =
  | {
      kind: 'friend'
      discordId: string
      label: string
      reason: string
    }
  | {
      kind: 'guild'
      guildId: string
      guildName: string
      reason: string
    }

export type VerificationBlacklistResult = {
  blocked: boolean
  hits: VerificationBlacklistHit[]
  message: string
}

export function buildBlockedMessage(hits: VerificationBlacklistHit[]): string {
  if (hits.length === 0) {
    return 'Verification is blocked until you remove the listed Discord connections.'
  }

  const lines = hits.map((hit) => {
    if (hit.kind === 'friend') {
      return `• Remove **${hit.label}** (\`${hit.discordId}\`) from your friends list — ${hit.reason}`
    }
    return `• Leave server **${hit.guildName}** (\`${hit.guildId}\`) — ${hit.reason}`
  })

  return [
    'Verification is blocked because of restricted Discord connections.',
    '',
    ...lines,
    '',
    'After you unfriend or leave the listed server(s), start verification again from Discord.',
  ].join('\n')
}

export async function checkVerificationBlacklist(input: {
  friendDiscordIds: string[]
  guildIds: string[]
  guildNames?: Record<string, string>
}): Promise<VerificationBlacklistResult> {
  const friendIds = [...new Set(input.friendDiscordIds.map((id) => String(id).trim()).filter(Boolean))]
  const guildIds = [...new Set(input.guildIds.map((id) => String(id).trim()).filter(Boolean))]

  const [friendRows, guildRows] = await Promise.all([
    friendIds.length
      ? prisma.verificationFriendBlacklist.findMany({
          where: { discordId: { in: friendIds } },
        })
      : Promise.resolve([]),
    guildIds.length
      ? prisma.verificationGuildBlacklist.findMany({
          where: { guildId: { in: guildIds } },
        })
      : Promise.resolve([]),
  ])

  const hits: VerificationBlacklistHit[] = [
    ...friendRows.map((row) => ({
      kind: 'friend' as const,
      discordId: row.discordId,
      label: row.label || `User ${row.discordId}`,
      reason: row.reason,
    })),
    ...guildRows.map((row) => ({
      kind: 'guild' as const,
      guildId: row.guildId,
      guildName: row.guildName || input.guildNames?.[row.guildId] || `Server ${row.guildId}`,
      reason: row.reason,
    })),
  ]

  return {
    blocked: hits.length > 0,
    hits,
    message: buildBlockedMessage(hits),
  }
}
