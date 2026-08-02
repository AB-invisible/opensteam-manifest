import { prisma } from '@/app/lib/prisma'
import { getDiscordCdnAvatarUrl } from '@/app/lib/discord-avatar'
import { fetchDiscordUserProfile } from '@/app/lib/discord-oauth-tokens'

export type ProfileSyncUser = {
  id: string
  discordId: string
  username: string
  avatar: string | null
  discordAccessToken: string | null
  discordRefreshToken: string | null
}

export type ProfileSyncResult = {
  changed: boolean
  username: string
  avatar: string | null
  usernameChanged: boolean
  avatarChanged: boolean
}

export type DiscordApiProfile = {
  id?: string
  username?: string
  avatar?: string | null
}

const PROFILE_SYNC_THROTTLE_MS = 6 * 60 * 60 * 1000
const lastProfileSyncByDiscordId = new Map<string, number>()

/** Returns true when the incoming Discord @handle differs from what we store. */
export function shouldUpdateDiscordUsername(
  current: string,
  incoming: string | null | undefined
): boolean {
  const next = typeof incoming === 'string' ? incoming.trim() : ''
  if (!next) return false
  return next !== current
}

/** Builds DB update fields from a Discord API profile response. */
export function buildProfileSyncData(
  current: { username: string; avatar: string | null },
  profile: DiscordApiProfile,
  discordId: string
): { data: { username?: string; avatar?: string }; changed: boolean; username: string; avatar: string | null; usernameChanged: boolean; avatarChanged: boolean } {
  const username = profile.username?.trim() || current.username
  const avatarHash = profile.avatar?.trim() || null
  const freshAvatarUrl = avatarHash
    ? getDiscordCdnAvatarUrl(profile.id || discordId, avatarHash, 128)
    : current.avatar
      ? getDiscordCdnAvatarUrl(discordId, current.avatar, 128)
      : getDiscordCdnAvatarUrl(discordId, null, 128)

  const usernameChanged = shouldUpdateDiscordUsername(current.username, profile.username)
  const avatarChanged = Boolean(
    avatarHash &&
      freshAvatarUrl &&
      freshAvatarUrl !== getDiscordCdnAvatarUrl(discordId, current.avatar, 128)
  )

  const data: { username?: string; avatar?: string } = {}
  if (usernameChanged) data.username = username
  if (avatarChanged && avatarHash) data.avatar = avatarHash

  return {
    data,
    changed: usernameChanged || avatarChanged,
    username,
    avatar: freshAvatarUrl,
    usernameChanged,
    avatarChanged,
  }
}

export async function applyDiscordUsernameToUser(
  userId: string,
  discordUsername: string
): Promise<{ changed: boolean; username: string }> {
  const next = discordUsername.trim()
  if (!next) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    })
    return { changed: false, username: user?.username || '' }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  })
  if (!user || user.username === next) {
    return { changed: false, username: user?.username || next }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { username: next },
  })

  return { changed: true, username: next }
}

export async function syncUserDiscordProfileFromGatewayUser(discordUser: {
  id: string
  username: string
}): Promise<ProfileSyncResult | null> {
  const discordId = String(discordUser.id).trim()
  const nextUsername = discordUser.username?.trim()
  if (!discordId || !nextUsername) return null

  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true, username: true, avatar: true },
  })
  if (!user) return null

  if (!shouldUpdateDiscordUsername(user.username, nextUsername)) {
    return {
      changed: false,
      username: user.username,
      avatar: user.avatar,
      usernameChanged: false,
      avatarChanged: false,
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { username: nextUsername },
  })

  return {
    changed: true,
    username: nextUsername,
    avatar: user.avatar,
    usernameChanged: true,
    avatarChanged: false,
  }
}

export async function syncUserDiscordProfileFromApi(
  user: ProfileSyncUser
): Promise<ProfileSyncResult & { reason?: 'no-token' | 'token-expired' | 'api-error' }> {
  const fallbackAvatar = getDiscordCdnAvatarUrl(user.discordId, null, 128)
  const fetchResult = await fetchDiscordUserProfile(user)
  if (!fetchResult.ok) {
    return {
      changed: false,
      username: user.username,
      avatar: user.avatar || fallbackAvatar,
      usernameChanged: false,
      avatarChanged: false,
      reason: fetchResult.reason,
    }
  }

  const discordProfile: DiscordApiProfile = fetchResult.profile

  const sync = buildProfileSyncData(user, discordProfile, user.discordId)
  if (sync.changed) {
    await prisma.user.update({
      where: { id: user.id },
      data: sync.data,
    })
  }

  return {
    changed: sync.changed,
    username: sync.username,
    avatar: sync.avatar,
    usernameChanged: sync.usernameChanged,
    avatarChanged: sync.avatarChanged,
  }
}

/** Throttled Discord API profile sync — at most once per 6h per discordId. */
export async function syncUserDiscordProfileFromApiThrottled(
  user: ProfileSyncUser
): Promise<(ProfileSyncResult & { skipped?: false }) | { skipped: true }> {
  if (!user.discordAccessToken && !user.discordRefreshToken) {
    return { skipped: true }
  }

  const now = Date.now()
  const last = lastProfileSyncByDiscordId.get(user.discordId) ?? 0
  if (now - last < PROFILE_SYNC_THROTTLE_MS) {
    return { skipped: true }
  }
  lastProfileSyncByDiscordId.set(user.discordId, now)

  const result = await syncUserDiscordProfileFromApi(user)
  return result
}
