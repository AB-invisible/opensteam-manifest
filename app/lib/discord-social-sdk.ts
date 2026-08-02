/**
 * Discord Social SDK (web verification) — relationships.read + friends-graph alt signals.
 * Accept Social SDK terms in the Discord Developer Portal for your application.
 * @see https://discord.com/developers/docs/topics/oauth2#shared-resources-oauth2-scopes
 */

import { prisma } from '@/app/lib/prisma'
import type { DiscordRelationship } from '@/app/lib/discord-verify-oauth'

/** @see https://discord.com/developers/resources/user#get-user-relationships */
export const DISCORD_RELATIONSHIP_TYPE = {
  FRIEND: 1,
  BLOCKED: 2,
  PENDING_INCOMING: 3,
  PENDING_OUTGOING: 4,
} as const

export type ParsedDiscordRelationship = {
  discordId: string
  type: number
  nickname: string | null
  username: string | null
  displayName: string | null
}

export type SocialGraphAltMatch = {
  userId: string
  discordId: string
  username: string
  reasons: string[]
}

export type SocialGraphAltResult = {
  matchedUserIds: string[]
  flags: string[]
  matches: SocialGraphAltMatch[]
  friendDiscordIds: string[]
}

export function parseDiscordRelationships(raw: unknown): ParsedDiscordRelationship[] {
  if (!Array.isArray(raw)) return []

  const parsed: ParsedDiscordRelationship[] = []
  for (const item of raw) {
    const rel = item as DiscordRelationship
    const discordId = rel.user?.id || rel.id
    if (!discordId || typeof rel.type !== 'number') continue
    parsed.push({
      discordId: String(discordId),
      type: rel.type,
      nickname: rel.nickname ?? null,
      username: rel.user?.username ?? null,
      displayName: rel.user?.global_name ?? rel.user?.username ?? null,
    })
  }
  return parsed
}

export function extractFriendDiscordIds(raw: unknown, excludeDiscordId?: string): string[] {
  const exclude = excludeDiscordId?.trim()
  return [
    ...new Set(
      parseDiscordRelationships(raw)
        .filter((r) => r.type === DISCORD_RELATIONSHIP_TYPE.FRIEND)
        .map((r) => r.discordId)
        .filter((id) => id && id !== exclude)
    ),
  ]
}

export function summarizeRelationshipsForStorage(raw: unknown) {
  const parsed = parseDiscordRelationships(raw)
  const friends = parsed.filter((r) => r.type === DISCORD_RELATIONSHIP_TYPE.FRIEND)
  const blocked = parsed.filter((r) => r.type === DISCORD_RELATIONSHIP_TYPE.BLOCKED)
  const pendingIncoming = parsed.filter((r) => r.type === DISCORD_RELATIONSHIP_TYPE.PENDING_INCOMING)
  const pendingOutgoing = parsed.filter((r) => r.type === DISCORD_RELATIONSHIP_TYPE.PENDING_OUTGOING)

  return {
    fetchedAt: new Date().toISOString(),
    total: parsed.length,
    friends: friends.length,
    blocked: blocked.length,
    pendingIncoming: pendingIncoming.length,
    pendingOutgoing: pendingOutgoing.length,
    friendDiscordIds: friends.map((f) => f.discordId),
    items: parsed.slice(0, 500),
  }
}

/**
 * Flag users who are Discord friends with banned / guild-banned OpenSteam accounts,
 * or friends who share verification fingerprints with other accounts.
 */
export async function detectSocialGraphAlts(input: {
  discordId: string
  friendDiscordIds: string[]
  fingerprint?: string | null
}): Promise<SocialGraphAltResult> {
  const friendIds = input.friendDiscordIds.filter((id) => id && id !== input.discordId)
  if (friendIds.length === 0) {
    return { matchedUserIds: [], flags: [], matches: [], friendDiscordIds: [] }
  }

  const matchedUserIds = new Set<string>()
  const flags = new Set<string>()
  const matches: SocialGraphAltMatch[] = []

  const friendUsers = await prisma.user.findMany({
    where: { discordId: { in: friendIds } },
    select: {
      id: true,
      discordId: true,
      username: true,
      isBanned: true,
      discordGuildBannedAt: true,
      fingerprint: true,
      verifyFingerprint: true,
    },
    take: 200,
  })

  for (const friend of friendUsers) {
    const reasons: string[] = []
    if (friend.isBanned) reasons.push('friend_site_banned')
    if (friend.discordGuildBannedAt) reasons.push('friend_guild_banned')
    if (
      input.fingerprint &&
      (friend.fingerprint === input.fingerprint || friend.verifyFingerprint === input.fingerprint)
    ) {
      reasons.push('friend_shared_fingerprint')
    }
    if (reasons.length === 0) continue

    matchedUserIds.add(friend.id)
    if (reasons.includes('friend_site_banned') || reasons.includes('friend_guild_banned')) {
      flags.add('friend_of_banned')
    }
    if (reasons.includes('friend_shared_fingerprint')) {
      flags.add('friend_fingerprint_match')
    }
    matches.push({
      userId: friend.id,
      discordId: friend.discordId,
      username: friend.username,
      reasons,
    })
  }

  return {
    matchedUserIds: Array.from(matchedUserIds),
    flags: Array.from(flags),
    matches,
    friendDiscordIds: friendIds,
  }
}

export function isSocialSdkRelationshipsAvailable(result: {
  ok: boolean
  status?: number
}): boolean {
  if (result.ok) return true
  // 403 = scope not granted / Social SDK terms not accepted
  return false
}
