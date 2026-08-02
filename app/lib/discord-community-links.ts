import { getDiscordVerifyConfig } from '@/app/lib/discord-verify-config'
import { prisma } from '@/app/lib/prisma'
import { getShareablePublicUrl, resolveOAuthSiteUrl } from '@/app/lib/public-app-url'

export const DISCORD_GUILD_ID =
  process.env.DISCORD_GUILD_ID?.trim() || '1532893645231886366'

export const DISCORD_COMMUNITY_INVITE_CONFIG_KEY = 'DISCORD_COMMUNITY_INVITE_URLS'

export type DiscordCommunityLinks = {
  rules: string | null
  announcements: string | null
  website: string
  discord: string
}

/** Fallback when the Discord API is unavailable or returns no invites. */
const FALLBACK_COMMUNITY_INVITES = [
  'https://discord.gg/4RdMhcYws',
] as const

/** @deprecated Use getCommunityInviteLinks() — kept for static fallbacks. */
export const DISCORD_COMMUNITY_INVITES = FALLBACK_COMMUNITY_INVITES

/** @deprecated Use getDiscordCommunityLinks() */
export const DISCORD_COMMUNITY_LINKS = {
  rules: null as string | null,
  announcements: null as string | null,
  website: resolveOAuthSiteUrl(),
  discord: `${resolveOAuthSiteUrl()}/discord`,
}

/** @deprecated Use getDiscordCommunityLinks() */
export const VERIFY_SUCCESS_LINKS = DISCORD_COMMUNITY_LINKS

type DiscordGuildInvite = {
  code?: string
  expires_at?: string | null
}

type DiscordVanityUrl = {
  code?: string
}

type DiscordGuildSnapshot = {
  rules_channel_id?: string | null
  public_updates_channel_id?: string | null
}

const INVITE_CACHE_TTL_MS = 5 * 60 * 1000
let inviteCache: { urls: string[]; fetchedAt: number } | null = null

export function discordChannelLink(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`
}

async function readConfigValue(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key },
    select: { value: true },
  })
  return row?.value?.trim() || process.env[key]?.trim() || null
}

async function fetchGuildSnapshot(
  guildId: string,
  botToken: string
): Promise<DiscordGuildSnapshot | null> {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    if (!res.ok) return null
    return (await res.json()) as DiscordGuildSnapshot
  } catch {
    return null
  }
}

/**
 * Resolve user-facing community links for DMs and emails (correct guild + public site URL).
 */
export async function getDiscordCommunityLinks(): Promise<DiscordCommunityLinks> {
  const cfg = await getDiscordVerifyConfig()
  const guildId = cfg.guildId || DISCORD_GUILD_ID
  const website = resolveOAuthSiteUrl()
  const discord = `${getShareablePublicUrl()}/discord`

  const [rulesChannelId, announcementsChannelId, guildSnapshot] = await Promise.all([
    readConfigValue('DISCORD_RULES_CHANNEL_ID'),
    readConfigValue('DISCORD_ANNOUNCEMENTS_CHANNEL_ID'),
    cfg.botToken ? fetchGuildSnapshot(guildId, cfg.botToken) : Promise.resolve(null),
  ])

  const rulesId = rulesChannelId || guildSnapshot?.rules_channel_id || null
  const announcementsId =
    announcementsChannelId ||
    guildSnapshot?.public_updates_channel_id ||
    (await readConfigValue('DISCORD_ADDED_GAMES_CHANNEL_ID'))

  return {
    rules: rulesId ? discordChannelLink(guildId, rulesId) : null,
    announcements: announcementsId ? discordChannelLink(guildId, announcementsId) : null,
    website,
    discord,
  }
}

export async function getVerifyChannelLink(): Promise<string> {
  const cfg = await getDiscordVerifyConfig()
  const guildId = cfg.guildId || DISCORD_GUILD_ID
  return discordChannelLink(guildId, cfg.verifyChannelId)
}

function inviteUrlFromCode(code: string): string {
  return `https://discord.gg/${code}`
}

function isInviteActive(invite: DiscordGuildInvite): boolean {
  if (!invite.code) return false
  if (!invite.expires_at) return true
  return new Date(invite.expires_at).getTime() > Date.now()
}

function isValidInviteUrl(url: string): boolean {
  return /^https:\/\/discord\.(gg|com\/invite)\//i.test(url)
}

export function parseSyncedCommunityInviteUrls(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => String(item || '').trim())
      .filter((url) => isValidInviteUrl(url))
  } catch {
    const single = raw.trim()
    return isValidInviteUrl(single) ? [single] : []
  }
}

async function readSyncedCommunityInviteUrls(): Promise<string[]> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: DISCORD_COMMUNITY_INVITE_CONFIG_KEY },
    select: { value: true },
  })
  return parseSyncedCommunityInviteUrls(row?.value)
}

/**
 * Fetch active guild invite links from Discord (vanity URL + channel invites).
 * Prefers bot-synced URLs in system config, then live API, then static fallbacks.
 */
export async function getCommunityInviteLinks(): Promise<string[]> {
  if (inviteCache && Date.now() - inviteCache.fetchedAt < INVITE_CACHE_TTL_MS) {
    return inviteCache.urls
  }

  const synced = await readSyncedCommunityInviteUrls()
  if (synced.length > 0) {
    inviteCache = { urls: synced, fetchedAt: Date.now() }
    return synced
  }

  const cfg = await getDiscordVerifyConfig()
  const guildId = cfg.guildId || DISCORD_GUILD_ID
  const botToken = cfg.botToken

  if (!botToken || !guildId) {
    return [...FALLBACK_COMMUNITY_INVITES]
  }

  const urls = new Set<string>()
  const headers = { Authorization: `Bot ${botToken}` }

  try {
    const vanityRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/vanity-url`, { headers })
    if (vanityRes.ok) {
      const vanity = (await vanityRes.json()) as DiscordVanityUrl
      if (vanity.code) urls.add(inviteUrlFromCode(vanity.code))
    }

    const invitesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/invites`, { headers })
    if (invitesRes.ok) {
      const invites = (await invitesRes.json()) as DiscordGuildInvite[]
      for (const invite of invites) {
        if (isInviteActive(invite)) {
          urls.add(inviteUrlFromCode(invite.code!))
        }
      }
    } else if (!vanityRes.ok) {
      console.warn('[CommunityInvites] Discord API error:', {
        vanity: vanityRes.status,
        invites: invitesRes.status,
      })
    }
  } catch (err) {
    console.warn('[CommunityInvites] fetch failed:', err)
    return [...FALLBACK_COMMUNITY_INVITES]
  }

  const list = urls.size > 0 ? Array.from(urls) : [...FALLBACK_COMMUNITY_INVITES]
  inviteCache = { urls: list, fetchedAt: Date.now() }
  return list
}

export function formatInviteList(invites: readonly string[]): string {
  return invites.map((url) => `• ${url}`).join('\n')
}
