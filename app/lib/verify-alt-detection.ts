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

export function discordSnowflakeToDate(snowflake: string): Date {
  try {
    return new Date(Number(BigInt(snowflake) >> BigInt(22)) + 1420070400000)
  } catch {
    return new Date()
  }
}
