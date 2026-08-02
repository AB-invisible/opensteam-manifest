import { prisma } from '@/app/lib/prisma'
import {
  resolveActiveOAuthCredentials,
  resolveOAuthCredentialsBySource,
  resolveGuildJoinBotToken,
  resolveBackupBotToken,
  resolvePrimaryBotToken,
  type BotTokenSource,
} from '@/app/lib/discord-bot-credentials'

type PersistResult = { stored: boolean; reason: 'updated' | 'no-user' | 'no-tokens' }

export type GuildEnsureOptions = {
  accessToken?: string | null
  refreshToken?: string | null
  /** login = fresh OAuth; background = sentinel / periodic checks */
  source?: 'login' | 'background'
}

async function probeDiscordAccessToken(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Skip guild ensure when there is nothing to try (avoids stale-JWT noise on sentinel). */
export async function shouldAttemptGuildEnsure(
  discordId: string,
  incoming?: Pick<GuildEnsureOptions, 'accessToken' | 'refreshToken'>
): Promise<boolean> {
  if (incoming?.accessToken || incoming?.refreshToken) return true
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { discordAccessToken: true, discordRefreshToken: true },
  })
  return Boolean(user?.discordAccessToken || user?.discordRefreshToken)
}

/** Canonical Discord user snowflake from OAuth (never the internal OpenSteam user id). */
export function resolveOAuthDiscordUserId(
  account?: { providerAccountId?: string } | null,
  user?: { id?: string | null } | null
): string | null {
  const id = account?.providerAccountId ?? user?.id
  return id ? String(id).trim() : null
}

async function resolveDiscordOAuthCredentials() {
  const { clientId, clientSecret } = await resolveActiveOAuthCredentials()
  return { clientId, clientSecret }
}

/**
 * Writes Discord OAuth tokens to the user row when we have them (login / JWT / /api/auth/me).
 * Uses updateMany so missing users on first OAuth callback do not throw.
 */
export async function persistDiscordOAuthTokens(
  discordId: string,
  accessToken?: string | null,
  refreshToken?: string | null
): Promise<PersistResult> {
  if (!accessToken && !refreshToken) {
    return { stored: false, reason: 'no-tokens' }
  }

  const data: Record<string, string> = {}
  if (accessToken) data.discordAccessToken = accessToken
  if (refreshToken) data.discordRefreshToken = refreshToken

  const result = await prisma.user.updateMany({
    where: { discordId },
    data: data as any,
  })

  if (result.count === 0) {
    return { stored: false, reason: 'no-user' }
  }

  return { stored: true, reason: 'updated' }
}

export async function clearDiscordOAuthTokens(discordId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { discordId },
    data: { discordAccessToken: null, discordRefreshToken: null },
  })
}

type DiscordTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
}

async function exchangeDiscordRefreshToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ ok: true; data: DiscordTokenResponse } | { ok: false; data: DiscordTokenResponse; status: number }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await res.json().catch(() => ({}))) as DiscordTokenResponse
  if (!res.ok || !data.access_token) {
    return { ok: false, data, status: res.status }
  }
  return { ok: true, data }
}

function alternateOAuthSource(source: BotTokenSource): BotTokenSource {
  return source === 'backup' ? 'primary' : 'backup'
}

/**
 * Refreshes an expired Discord OAuth access token and persists the new pair.
 * Retries with the other OAuth app when failover mode changed since login.
 */
export async function refreshDiscordAccessToken(
  discordId: string,
  refreshToken: string
): Promise<string | null> {
  const active = await resolveActiveOAuthCredentials()
  const attempts: BotTokenSource[] = [active.source]
  const alternate = alternateOAuthSource(active.source)
  if (!attempts.includes(alternate)) attempts.push(alternate)

  let lastError: string | undefined

  for (const source of attempts) {
    const { clientId, clientSecret } = await resolveOAuthCredentialsBySource(source)
    if (!clientId || !clientSecret) continue

    const result = await exchangeDiscordRefreshToken(clientId, clientSecret, refreshToken)
    if (result.ok) {
      await persistDiscordOAuthTokens(
        discordId,
        result.data.access_token!,
        result.data.refresh_token ?? refreshToken
      )
      if (source !== active.source) {
        console.info('[Discord OAuth] Token refresh succeeded with alternate OAuth app:', source, discordId)
      }
      return result.data.access_token!
    }

    lastError = result.data.error || String(result.status)
    const retryable =
      result.data.error === 'invalid_grant' || result.data.error === 'invalid_token'
    if (!retryable) break
  }

  console.error('[Discord OAuth] Token refresh failed:', lastError || 'unknown', discordId)
  if (lastError === 'invalid_grant' || lastError === 'invalid_token') {
    await clearDiscordOAuthTokens(discordId)
    const { revokeWebSessionForOAuthExpired } = await import('./web-session-revoke')
    await revokeWebSessionForOAuthExpired(discordId)
  }
  return null
}

/**
 * Returns a usable Discord user access token, refreshing from DB refresh token when needed.
 */
export async function getValidDiscordAccessToken(user: {
  discordId: string
  discordAccessToken: string | null
  discordRefreshToken: string | null
}): Promise<string | null> {
  if (user.discordAccessToken) {
    return user.discordAccessToken
  }

  if (user.discordRefreshToken) {
    return refreshDiscordAccessToken(user.discordId, user.discordRefreshToken)
  }

  return null
}

type DiscordTokenUser = {
  discordId: string
  discordAccessToken: string | null
  discordRefreshToken: string | null
}

async function fetchDiscordUsersMe(accessToken: string): Promise<Response> {
  return fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  })
}

/** Like getValidDiscordAccessToken, but refreshes when Discord rejects the stored access token. */
export async function getDiscordAccessTokenForApi(user: DiscordTokenUser): Promise<string | null> {
  const token = await getValidDiscordAccessToken(user)
  if (!token) return null

  const probe = await fetchDiscordUsersMe(token)

  if (probe.ok) return token
  if (probe.status !== 401 || !user.discordRefreshToken) return token

  return refreshDiscordAccessToken(user.discordId, user.discordRefreshToken)
}

export type DiscordUserProfilePayload = {
  id?: string
  username?: string
  avatar?: string | null
}

export type FetchDiscordUserProfileResult =
  | { ok: true; profile: DiscordUserProfilePayload }
  | { ok: false; reason: 'no-token' | 'token-expired' | 'api-error' }

/** Single /users/@me fetch with token refresh — avoids probing then re-fetching. */
export async function fetchDiscordUserProfile(
  user: DiscordTokenUser
): Promise<FetchDiscordUserProfileResult> {
  const token = await getValidDiscordAccessToken(user)
  if (!token) return { ok: false, reason: 'no-token' }

  let res = await fetchDiscordUsersMe(token)
  if (res.status === 401 && user.discordRefreshToken) {
    const fresh = await refreshDiscordAccessToken(user.discordId, user.discordRefreshToken)
    if (fresh) res = await fetchDiscordUsersMe(fresh)
  }

  if (res.status === 401) return { ok: false, reason: 'token-expired' }
  if (!res.ok) return { ok: false, reason: 'api-error' }

  try {
    const profile = (await res.json()) as DiscordUserProfilePayload
    return { ok: true, profile }
  } catch {
    return { ok: false, reason: 'api-error' }
  }
}

type PullbackUser = {
  id: string
  discordId: string
  username: string
  discordAccessToken: string | null
  discordRefreshToken: string | null
}

export type GuildMemberOAuthResult =
  | { ok: true; outcome: 'joined' | 'already-member'; refreshed?: boolean }
  | { ok: false; reason: 'no-token' | 'api-error' | 'not-configured' | 'user-not-found'; status?: number; code?: number; message?: string }

function isTokenFailure(status: number, data: { code?: number; message?: string } | null): boolean {
  if (status === 401) return true
  const msg = (data?.message || '').toLowerCase()
  if (msg.includes('invalid oauth2 access token')) return true
  if (status !== 403) return false
  const code = data?.code
  return code === 50025 || code === 50001 || code === 50013
}

async function addGuildMemberWithOAuth(input: {
  guildId: string
  botToken: string
  user: PullbackUser
  /** Fresh login tokens — skip DB lookup when probe would discard a just-issued access token. */
  preferIncomingTokens?: boolean
}): Promise<GuildMemberOAuthResult> {
  const tryAdd = async (accessToken: string) => {
    const res = await fetch(`https://discord.com/api/v10/guilds/${input.guildId}/members/${input.user.discordId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${input.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    })
    const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string }
    return { status: res.status, data, statusText: res.statusText }
  }

  let accessToken = input.preferIncomingTokens && input.user.discordAccessToken
    ? input.user.discordAccessToken
    : await getDiscordAccessTokenForApi(input.user)
  if (!accessToken) {
    return { ok: false, reason: 'no-token' }
  }

  let res = await tryAdd(accessToken)
  if (res.status === 201) {
    return { ok: true, outcome: 'joined' }
  }
  if (res.status === 204) {
    return { ok: true, outcome: 'already-member' }
  }

  if (isTokenFailure(res.status, res.data) && input.user.discordRefreshToken) {
    const freshToken = await refreshDiscordAccessToken(input.user.discordId, input.user.discordRefreshToken)
    if (freshToken) {
      res = await tryAdd(freshToken)
      if (res.status === 201) {
        return { ok: true, outcome: 'joined', refreshed: true }
      }
      if (res.status === 204) {
        return { ok: true, outcome: 'already-member', refreshed: true }
      }
    } else {
      const { revokeWebSessionForOAuthExpired } = await import('./web-session-revoke')
      await revokeWebSessionForOAuthExpired(input.user.discordId)
      return { ok: false, reason: 'no-token', message: 'OAuth tokens expired — sign in again' }
    }
  }

  if (isTokenFailure(res.status, res.data)) {
    await clearDiscordOAuthTokens(input.user.discordId)
    const { revokeWebSessionForOAuthExpired } = await import('./web-session-revoke')
    await revokeWebSessionForOAuthExpired(input.user.discordId)
    return { ok: false, reason: 'no-token', message: res.data?.message || 'Invalid OAuth2 access token' }
  }

  return {
    ok: false,
    reason: 'api-error',
    status: res.status,
    code: res.data?.code,
    message: res.data?.message || res.statusText,
  }
}

const PULLBACK_USER_SELECT = {
  id: true,
  discordId: true,
  username: true,
  discordAccessToken: true,
  discordRefreshToken: true,
} as const

export type DiscordPullbackSuccess = {
  ok: true
  total: number
  joined: number
  alreadyMember: number
  expired: number
  failed: number
  failureSamples: string[]
  targetUser: PullbackUser | null
}

export type DiscordPullbackFailure = { ok: false; error: string }

/**
 * Ensures the user is a member of the configured Discord guild via guilds.join OAuth.
 * Non-blocking: returns a result object; callers should log failures without blocking login.
 */
export async function ensureDiscordGuildMembership(
  discordId: string,
  options?: GuildEnsureOptions
): Promise<GuildMemberOAuthResult> {
  const [guildConfig, joinBot, user] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }),
    resolveGuildJoinBotToken(),
    prisma.user.findUnique({
      where: { discordId },
      select: PULLBACK_USER_SELECT,
    }),
  ])

  if (!guildConfig?.value || !joinBot.token) {
    return { ok: false, reason: 'not-configured' }
  }

  let incomingAccess = options?.accessToken ?? null
  const incomingRefresh = options?.refreshToken ?? null
  const isFreshLogin = options?.source === 'login' && Boolean(incomingAccess || incomingRefresh)

  // JWT session tokens go stale; do not overwrite DB with an expired access token.
  if (incomingAccess && !isFreshLogin) {
    const valid = await probeDiscordAccessToken(incomingAccess)
    if (!valid) incomingAccess = null
  }

  if (user && (incomingAccess || incomingRefresh)) {
    await persistDiscordOAuthTokens(discordId, incomingAccess, incomingRefresh)
  }

  if (!user) {
    if (!incomingAccess && !incomingRefresh) {
      return { ok: false, reason: 'user-not-found' }
    }
    // First OAuth sign-in: user row is created later in /api/auth/me — use fresh tokens now.
    return addGuildMemberWithOAuth({
      guildId: guildConfig.value,
      botToken: joinBot.token,
      preferIncomingTokens: true,
      user: {
        id: 'pending',
        discordId,
        username: 'pending',
        discordAccessToken: incomingAccess,
        discordRefreshToken: incomingRefresh,
      },
    })
  }

  const pullbackUser =
    (await prisma.user.findUnique({
      where: { discordId },
      select: PULLBACK_USER_SELECT,
    })) ?? user

  const memberUser: PullbackUser = isFreshLogin
    ? {
        ...pullbackUser,
        discordAccessToken: incomingAccess ?? pullbackUser.discordAccessToken,
        discordRefreshToken: incomingRefresh ?? pullbackUser.discordRefreshToken,
      }
    : pullbackUser

  return addGuildMemberWithOAuth({
    guildId: guildConfig.value,
    botToken: joinBot.token,
    preferIncomingTokens: isFreshLogin,
    user: memberUser,
  })
}

const GUILD_ENSURE_INTERVAL_MS = 24 * 60 * 60 * 1000
const lastGuildEnsureByUserId = new Map<string, number>()

/** Throttled guild ensure — at most once per 24h per internal user id. */
export async function ensureDiscordGuildMembershipThrottled(
  userId: string,
  discordId: string,
  options?: GuildEnsureOptions
): Promise<void> {
  const now = Date.now()
  const last = lastGuildEnsureByUserId.get(userId) ?? 0
  if (now - last < GUILD_ENSURE_INTERVAL_MS) return

  lastGuildEnsureByUserId.set(userId, now)
  const result = await ensureDiscordGuildMembership(discordId, options)
  if (!result.ok) {
    const isBackground = options?.source === 'background'
    if (isBackground && (result.reason === 'no-token' || result.reason === 'user-not-found')) {
      return
    }

    const guildConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } })
    const payload = {
      discordId,
      guildId: guildConfig?.value ?? null,
      reason: result.reason,
      message: result.message || undefined,
      source: options?.source ?? 'login',
    }
    console.warn('[Discord Guild] Ensure membership failed:', payload)

    if (!isBackground) {
      if (result.reason === 'no-token') {
        const { revokeWebSessionForOAuthExpired } = await import('./web-session-revoke')
        await revokeWebSessionForOAuthExpired(discordId)
      }

      void import('./auth-issue-log').then(({ logAuthIssue }) => {
        logAuthIssue({
          stage: 'guild_ensure:failed',
          error: result.message || result.reason,
          discordId,
          flow: 'login',
          details: {
            guildId: payload.guildId,
            reason: result.reason,
            status: result.status,
            code: result.code,
          },
        })
      })
    }
  }
}

export async function runDiscordPullback(options: {
  userId?: string
}): Promise<DiscordPullbackSuccess | DiscordPullbackFailure> {
  const userId = options.userId ? String(options.userId).replace(/[<@!>]/g, '').trim() : null

  const [guildConfig, joinBot, oauthCredentials] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }),
    resolveGuildJoinBotToken(),
    resolveDiscordOAuthCredentials(),
  ])

  if (!guildConfig?.value || !joinBot.token) {
    return { ok: false, error: 'Missing Guild ID or bot token for guilds.join.' }
  }

  if (!oauthCredentials.clientId || !oauthCredentials.clientSecret) {
    return {
      ok: false,
      error: 'Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET (env or Admin settings).',
    }
  }

  let usersWithTokens: PullbackUser[]
  if (userId) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { discordId: userId }] },
      select: PULLBACK_USER_SELECT,
    })
    if (!user) {
      return { ok: false, error: 'User not found. Provide a valid OpenSteam user ID or Discord ID.' }
    }
    if (!user.discordAccessToken && !user.discordRefreshToken) {
      return {
        ok: false,
        error: 'User has no saved Discord OAuth tokens. They must sign in to OpenSteam again (guilds.join scope).',
      }
    }
    usersWithTokens = [user]
  } else {
    usersWithTokens = await prisma.user.findMany({
      where: {
        OR: [{ discordAccessToken: { not: null } }, { discordRefreshToken: { not: null } }],
      },
      select: PULLBACK_USER_SELECT,
    })
    if (usersWithTokens.length === 0) {
      return { ok: false, error: 'No users found with saved Discord OAuth tokens.' }
    }
  }

  let joined = 0
  let alreadyMember = 0
  let failed = 0
  let expired = 0
  const failureSamples: string[] = []

  const alternateBotToken =
    joinBot.source === 'backup'
      ? await resolvePrimaryBotToken()
      : await resolveBackupBotToken()

  for (const u of usersWithTokens) {
    try {
      let result = await addGuildMemberWithOAuth({
        guildId: guildConfig.value,
        botToken: joinBot.token,
        user: u,
      })

      if (
        !result.ok &&
        alternateBotToken &&
        alternateBotToken !== joinBot.token &&
        (result.reason === 'no-token' || result.status === 401 || result.code === 50025)
      ) {
        result = await addGuildMemberWithOAuth({
          guildId: guildConfig.value,
          botToken: alternateBotToken,
          user: u,
        })
      }

      if (result.ok) {
        if (result.outcome === 'joined') joined++
        else alreadyMember++
      } else if (result.reason === 'no-token') {
        expired++
      } else if (result.status === 401 || result.code === 50025) {
        expired++
      } else {
        failed++
        if (failureSamples.length < 5) {
          failureSamples.push(
            `${u.username || u.discordId}: ${result.status || '?'} ${result.message || result.reason || 'unknown'}`
          )
        }
      }
    } catch (err: any) {
      failed++
      if (failureSamples.length < 5) {
        failureSamples.push(`${u.username || u.discordId}: ${err.message}`)
      }
    }

    await new Promise((r) => setTimeout(r, 200))
  }

  return {
    ok: true,
    total: usersWithTokens.length,
    joined,
    alreadyMember,
    expired,
    failed,
    failureSamples,
    targetUser: userId ? usersWithTokens[0] : null,
  }
}
