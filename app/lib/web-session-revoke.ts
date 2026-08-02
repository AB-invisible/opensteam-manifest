import { prisma } from './prisma'

export type WebSessionRevokeReason = 'guild_left' | 'guild_banned' | 'inactivity' | 'oauth_expired'

export function isWebSessionRevoked(user: {
  webSessionRevokedAt?: Date | null
}): boolean {
  return Boolean(user.webSessionRevokedAt)
}

/** True if the user ever authenticated on opensteam.lol (login or completed verification). */
export function hasEverUsedWebLogin(user: {
  webLoginAt?: Date | null
  discordVerifiedAt?: Date | null
  discordAccessToken?: string | null
  discordRefreshToken?: string | null
  lastIp?: string | null
}): boolean {
  if (user.webLoginAt || user.discordVerifiedAt) return true
  return Boolean(user.discordAccessToken || user.discordRefreshToken || user.lastIp)
}

export async function markWebLogin(discordId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { discordId, webLoginAt: null },
    data: { webLoginAt: new Date() },
  })
}

export async function revokeWebSessionForGuildLeave(discordId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: {
      id: true,
      webLoginAt: true,
      discordVerifiedAt: true,
      discordAccessToken: true,
      discordRefreshToken: true,
      lastIp: true,
    },
  })
  if (!user || !hasEverUsedWebLogin(user)) {
    return false
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      webSessionRevokedAt: new Date(),
      webSessionRevokeReason: 'guild_left',
      discordVerifiedAt: null,
    },
  })
  return true
}

/** Force logout when banned from the Discord guild (user may sign in again with restrictions). */
export async function revokeWebSessionForGuildBan(discordId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: {
      id: true,
      webLoginAt: true,
      discordVerifiedAt: true,
      discordAccessToken: true,
      discordRefreshToken: true,
      lastIp: true,
    },
  })
  if (!user || !hasEverUsedWebLogin(user)) {
    return false
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      webSessionRevokedAt: new Date(),
      webSessionRevokeReason: 'guild_banned',
    },
  })
  return true
}

/** Force logout when Discord OAuth refresh tokens are revoked or expired. */
export async function revokeWebSessionForOAuthExpired(discordId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: {
      id: true,
      webLoginAt: true,
      discordVerifiedAt: true,
      discordAccessToken: true,
      discordRefreshToken: true,
      lastIp: true,
    },
  })
  if (!user || !hasEverUsedWebLogin(user)) {
    return false
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      webSessionRevokedAt: new Date(),
      webSessionRevokeReason: 'oauth_expired',
      discordAccessToken: null,
      discordRefreshToken: null,
    },
  })
  return true
}

export async function clearWebSessionRevoke(discordId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { discordId },
    data: { webSessionRevokedAt: null, webSessionRevokeReason: null },
  })
}

/** After OAuth login while guild-banned: allow a new session but keep service restrictions. */
export async function clearWebSessionRevokeForGuildBannedLogin(discordId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { discordId, discordGuildBannedAt: { not: null } },
    data: { webSessionRevokedAt: null, webSessionRevokeReason: null },
  })
}

export function assertWebSessionNotRevoked(user: {
  webSessionRevokedAt?: Date | null
  webSessionRevokeReason?: string | null
}): { ok: true } | { ok: false; reason: WebSessionRevokeReason } {
  if (isWebSessionRevoked(user)) {
    const reason = user.webSessionRevokeReason
    if (reason === 'guild_banned') return { ok: false, reason: 'guild_banned' }
    if (reason === 'oauth_expired') return { ok: false, reason: 'oauth_expired' }
    if (reason === 'guild_left') return { ok: false, reason: 'guild_left' }
    return { ok: false, reason: 'guild_left' }
  }
  return { ok: true }
}
