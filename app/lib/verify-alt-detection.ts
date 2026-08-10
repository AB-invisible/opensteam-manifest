import { prisma } from '@/app/lib/prisma'
import { detectSocialGraphAlts, type SocialGraphAltMatch } from '@/app/lib/discord-social-sdk'

export type AltDetectionInput = {
  discordId: string
  ip: string
  fingerprint?: string | null
  email?: string | null
  friendDiscordIds?: string[]
}

export type AltDetectionResult = {
  altMatchedUserIds: string[]
  flags: string[]
  socialGraphMatches: SocialGraphAltMatch[]
}

export async function detectVerificationAlts(input: AltDetectionInput): Promise<AltDetectionResult> {
  const altMatchedUserIds = new Set<string>()
  const flags: string[] = []

  if (input.ip && input.ip !== 'unknown') {
    const ipMatches = await prisma.user.findMany({
      where: {
        discordId: { not: input.discordId },
        OR: [{ verifyIp: input.ip }, { lastIp: input.ip }],
      },
      select: { id: true },
      take: 20,
    })
    if (ipMatches.length > 0) {
      flags.push('ip_match')
      ipMatches.forEach((u) => altMatchedUserIds.add(u.id))
    }
  }

  if (input.fingerprint) {
    const fpMatches = await prisma.user.findMany({
      where: {
        discordId: { not: input.discordId },
        OR: [{ verifyFingerprint: input.fingerprint }, { fingerprint: input.fingerprint }],
      },
      select: { id: true },
      take: 20,
    })
    if (fpMatches.length > 0) {
      flags.push('fingerprint_match')
      fpMatches.forEach((u) => altMatchedUserIds.add(u.id))
    }
  }

  if (input.email) {
    const emailMatches = await prisma.user.findMany({
      where: {
        discordId: { not: input.discordId },
        email: input.email,
      },
      select: { id: true },
      take: 5,
    })
    if (emailMatches.length > 0) {
      flags.push('email_match')
      emailMatches.forEach((u) => altMatchedUserIds.add(u.id))
    }
  }

  let socialGraphMatches: SocialGraphAltMatch[] = []
  if (input.friendDiscordIds && input.friendDiscordIds.length > 0) {
    const social = await detectSocialGraphAlts({
      discordId: input.discordId,
      friendDiscordIds: input.friendDiscordIds,
      fingerprint: input.fingerprint,
    })
    socialGraphMatches = social.matches
    for (const flag of social.flags) {
      if (!flags.includes(flag)) flags.push(flag)
    }
    social.matchedUserIds.forEach((id) => altMatchedUserIds.add(id))
  }

  return {
    altMatchedUserIds: Array.from(altMatchedUserIds),
    flags,
    socialGraphMatches,
  }
}

export type ResolvedAltAccount = {
  userId: string
  username: string
  discordId: string
  inGuild: boolean
}

async function isDiscordGuildMember(
  guildId: string,
  discordId: string,
  botToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
        signal: AbortSignal.timeout(5000),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

/** Resolve matched platform users and whether they are currently in the verify guild. */
export async function resolveAltMatchedAccounts(
  altMatchedUserIds: string[],
  guildId: string,
  botToken: string | null | undefined,
): Promise<ResolvedAltAccount[]> {
  if (altMatchedUserIds.length === 0) return []

  const users = await prisma.user.findMany({
    where: { id: { in: altMatchedUserIds } },
    select: { id: true, username: true, discordId: true },
  })

  const token = botToken?.trim()
  return Promise.all(
    users.map(async (user) => ({
      userId: user.id,
      username: user.username,
      discordId: user.discordId,
      inGuild: token ? await isDiscordGuildMember(guildId, user.discordId, token) : false,
    })),
  )
}

export function discordSnowflakeToDate(snowflake: string): Date {
  try {
    return new Date(Number(BigInt(snowflake) >> BigInt(22)) + 1420070400000)
  } catch {
    return new Date()
  }
}
