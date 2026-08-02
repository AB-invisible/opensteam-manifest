import type { DiscordFetchResult } from './discord-verify-oauth'

export type DiscordConnection = {
  type?: string
  id?: string
  name?: string
  verified?: boolean
  visibility?: number
  friend_sync?: boolean
  show_activity?: boolean
  two_way_link?: boolean
}

export type DiscordGuild = {
  id?: string
  name?: string
  icon?: string | null
  owner?: boolean
  permissions?: string
  features?: string[]
}

export type DiscordGuildMember = {
  nick?: string | null
  roles?: string[]
  joined_at?: string
  premium_since?: string | null
  avatar?: string | null
  banner?: string | null
  communication_disabled_until?: string | null
}

export type DiscordUserProfile = {
  id: string
  username: string
  discriminator?: string
  global_name?: string | null
  avatar?: string | null
  banner?: string | null
  accent_color?: number | null
  banner_color?: number | null
  locale?: string | null
  mfa_enabled?: boolean
  premium_type?: number
  verified?: boolean
  email?: string | null
  public_flags?: number
  flags?: number
}

export type DiscordVerifyIntel = {
  profile: {
    id: string
    username: string
    displayName: string
    discriminator: string
    email: string | null
    emailVerified: boolean
    avatarHash: string | null
    bannerHash: string | null
    accentColor: number | null
    locale: string | null
    mfaEnabled: boolean
    premiumType: number
    premiumLabel: string
    publicFlags: number
    badges: string[]
    accountCreatedAt: string
    accountAgeDays: number
  }
  connections: {
    total: number
    verifiedCount: number
    byType: Record<string, number>
    items: Array<{ type: string; name: string; verified: boolean }>
  }
  guilds: {
    total: number
    ownedCount: number
    names: string[]
  }
  guildMember: DiscordGuildMember | null
  relationships?: {
    total: number
    friends: number
    blocked: number
    pendingIncoming: number
    pendingOutgoing: number
    sampleUsernames: string[]
  }
  fetchedAt: string
}

const PUBLIC_FLAG_BADGES: Array<{ bit: number; label: string }> = [
  { bit: 1 << 0, label: 'Discord Staff' },
  { bit: 1 << 1, label: 'Partner' },
  { bit: 1 << 2, label: 'HypeSquad Events' },
  { bit: 1 << 3, label: 'Bug Hunter L1' },
  { bit: 1 << 6, label: 'HypeSquad Bravery' },
  { bit: 1 << 7, label: 'HypeSquad Brilliance' },
  { bit: 1 << 8, label: 'HypeSquad Balance' },
  { bit: 1 << 9, label: 'Early Supporter' },
  { bit: 1 << 14, label: 'Bug Hunter L2' },
  { bit: 1 << 17, label: 'Early Verified Bot Dev' },
  { bit: 1 << 18, label: 'Moderator Programs Alumni' },
  { bit: 1 << 22, label: 'Active Developer' },
]

export function parsePublicFlagBadges(flags?: number): string[] {
  if (!flags) return []
  const badges: string[] = []
  for (const { bit, label } of PUBLIC_FLAG_BADGES) {
    if (flags & bit) badges.push(label)
  }
  return badges
}

export function premiumTypeLabel(premiumType?: number): string {
  switch (premiumType) {
    case 1:
      return 'Nitro Classic'
    case 2:
      return 'Nitro'
    case 3:
      return 'Nitro Basic'
    default:
      return 'None'
  }
}

export function formatDiscordDisplayName(username: string, globalName?: string | null, discriminator?: string) {
  if (globalName?.trim()) return globalName.trim()
  if (discriminator && discriminator !== '0' && discriminator !== '0000') {
    return `${username}#${discriminator}`
  }
  return username
}

export function summarizeConnections(raw: unknown): DiscordVerifyIntel['connections'] {
  const list = Array.isArray(raw) ? (raw as DiscordConnection[]) : []
  const byType: Record<string, number> = {}
  let verifiedCount = 0
  const items: DiscordVerifyIntel['connections']['items'] = []

  for (const c of list) {
    const type = c.type || 'unknown'
    byType[type] = (byType[type] || 0) + 1
    if (c.verified) verifiedCount++
    items.push({
      type,
      name: c.name || c.id || 'unnamed',
      verified: !!c.verified,
    })
  }

  return {
    total: list.length,
    verifiedCount,
    byType,
    items: items.slice(0, 30),
  }
}

export function summarizeGuilds(raw: unknown): DiscordVerifyIntel['guilds'] {
  const list = Array.isArray(raw) ? (raw as DiscordGuild[]) : []
  const ownedCount = list.filter((g) => g.owner).length
  return {
    total: list.length,
    ownedCount,
    names: list.slice(0, 40).map((g) => g.name || g.id || 'unknown'),
  }
}

/** Discord relationship types: 1=friend, 2=blocked, 3=pending incoming, 4=pending outgoing */
export function summarizeRelationships(raw: unknown): DiscordVerifyIntel['relationships'] {
  const list = Array.isArray(raw) ? raw : []
  let friends = 0
  let blocked = 0
  let pendingIncoming = 0
  let pendingOutgoing = 0
  const sampleUsernames: string[] = []

  for (const item of list) {
    const rel = item as { type?: number; user?: { username?: string; global_name?: string | null } }
    switch (rel.type) {
      case 1:
        friends++
        break
      case 2:
        blocked++
        break
      case 3:
        pendingIncoming++
        break
      case 4:
        pendingOutgoing++
        break
      default:
        break
    }
    if (sampleUsernames.length < 20) {
      const name = rel.user?.global_name || rel.user?.username
      if (name) sampleUsernames.push(name)
    }
  }

  return {
    total: list.length,
    friends,
    blocked,
    pendingIncoming,
    pendingOutgoing,
    sampleUsernames,
  }
}

export function buildDiscordVerifyIntel(input: {
  profile: DiscordUserProfile
  connections: unknown
  guilds: unknown
  guildMember: DiscordGuildMember | null
  relationships?: unknown
  accountCreatedAt: Date
}): DiscordVerifyIntel {
  const accountAgeDays = Math.floor((Date.now() - input.accountCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
  const flags = input.profile.public_flags ?? input.profile.flags ?? 0

  return {
    profile: {
      id: input.profile.id,
      username: input.profile.username,
      displayName: formatDiscordDisplayName(
        input.profile.username,
        input.profile.global_name,
        input.profile.discriminator,
      ),
      discriminator: input.profile.discriminator || '0',
      email: input.profile.email ?? null,
      emailVerified: !!input.profile.verified,
      avatarHash: input.profile.avatar ?? null,
      bannerHash: input.profile.banner ?? null,
      accentColor: input.profile.accent_color ?? input.profile.banner_color ?? null,
      locale: input.profile.locale ?? null,
      mfaEnabled: !!input.profile.mfa_enabled,
      premiumType: input.profile.premium_type ?? 0,
      premiumLabel: premiumTypeLabel(input.profile.premium_type),
      publicFlags: flags,
      badges: parsePublicFlagBadges(flags),
      accountCreatedAt: input.accountCreatedAt.toISOString(),
      accountAgeDays,
    },
    connections: summarizeConnections(input.connections),
    guilds: summarizeGuilds(input.guilds),
    guildMember: input.guildMember,
    ...(input.relationships !== undefined
      ? { relationships: summarizeRelationships(input.relationships) }
      : {}),
    fetchedAt: new Date().toISOString(),
  }
}

export async function fetchDiscordGuildMember(
  accessToken: string,
  guildId: string,
): Promise<DiscordFetchResult<DiscordGuildMember | null>> {
  try {
    const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404) {
      return { ok: true, data: null }
    }
    if (!res.ok) {
      const error = await res.text().catch(() => res.statusText)
      return { ok: false, data: null, status: res.status, error }
    }
    const data = (await res.json()) as DiscordGuildMember
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, data: null, status: 0, error: message }
  }
}
