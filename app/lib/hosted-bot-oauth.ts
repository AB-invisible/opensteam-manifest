import crypto from 'crypto'
import { prisma } from './prisma'
import { CUSTOM_PLANS, canLinkBrandedHostedBot, getBrandedLinkPlanError, isHostedBotPlanActive } from './hosted-bot-plans'
import {
  buildBotInviteUrl,
  ensureBrandedHostedInstanceForUser,
  ensureCustomHostedInstanceForUser,
  getAppBaseUrl,
  getBrandedBotConfig,
  getBrandedOAuthRedirectUrl,
  getCustomOAuthRedirectUrl,
  validateHostedGuildLink,
  verifyBotInGuild,
  verifyUserManagesGuild,
} from './hosted-bot'
import { decryptHostedBotSecret } from './hosted-bot-crypto'
import { persistDiscordOAuthTokens } from './discord-oauth-tokens'

const STATE_TTL_MS = 10 * 60 * 1000

export type HostedLinkStateType = 'branded-link' | 'custom-link'

export type HostedLinkState = {
  type: HostedLinkStateType
  guildId: string
  discordId: string
  exp: number
}

function getStateSecret(): Buffer {
  const hex = process.env.HOSTED_BOT_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('HOSTED_BOT_ENCRYPTION_KEY is required for hosted bot OAuth')
  }
  return Buffer.from(hex, 'hex')
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex')
}

export function createHostedLinkState(
  type: HostedLinkStateType,
  guildId: string,
  discordId: string
): string {
  const payload = Buffer.from(
    JSON.stringify({
      g: guildId,
      d: discordId,
      e: Date.now() + STATE_TTL_MS,
      t: type,
    })
  ).toString('base64url')
  return `${payload}.${signPayload(payload)}`
}

export function parseHostedLinkState(state: string): HostedLinkState | null {
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  if (signPayload(payload) !== sig) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      g?: string
      d?: string
      e?: number
      t?: HostedLinkStateType
    }
    if (
      (parsed.t !== 'branded-link' && parsed.t !== 'custom-link') ||
      !parsed.g ||
      !parsed.d ||
      !parsed.e
    ) {
      return null
    }
    if (Date.now() > parsed.e) return null
    return { type: parsed.t, guildId: parsed.g, discordId: parsed.d, exp: parsed.e }
  } catch {
    return null
  }
}

/** @deprecated use createHostedLinkState('branded-link', ...) */
export type BrandedLinkState = HostedLinkState

export function createBrandedLinkState(guildId: string, discordId: string): string {
  return createHostedLinkState('branded-link', guildId, discordId)
}

export function parseBrandedLinkState(state: string): HostedLinkState | null {
  const parsed = parseHostedLinkState(state)
  if (!parsed || parsed.type !== 'branded-link') return null
  return parsed
}

function buildLinkOAuthUrl(input: {
  clientId: string
  redirectUri: string
  guildId: string
  discordId: string
  linkType: HostedLinkStateType
}): string {
  const state = createHostedLinkState(input.linkType, input.guildId, input.discordId)
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  })
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`
}

export function buildBrandedLinkOAuthUrl(input: {
  clientId: string
  guildId: string
  discordId: string
}): string {
  return buildLinkOAuthUrl({
    clientId: input.clientId,
    redirectUri: getBrandedOAuthRedirectUrl(),
    guildId: input.guildId,
    discordId: input.discordId,
    linkType: 'branded-link',
  })
}

export function buildCustomLinkOAuthUrl(input: {
  clientId: string
  guildId: string
  discordId: string
}): string {
  return buildLinkOAuthUrl({
    clientId: input.clientId,
    redirectUri: getCustomOAuthRedirectUrl(),
    guildId: input.guildId,
    discordId: input.discordId,
    linkType: 'custom-link',
  })
}

async function exchangeOAuthCode(input: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  })

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    error?: string
  }

  if (!res.ok || !data.access_token) {
    throw new Error(data.error || 'OAuth token exchange failed')
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
  }
}

export async function exchangeBrandedOAuthCode(code: string) {
  const config = await getBrandedBotConfig()
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Branded bot OAuth is not configured')
  }

  return exchangeOAuthCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: getBrandedOAuthRedirectUrl(),
    code,
  })
}

export async function exchangeCustomOAuthCode(code: string, discordId: string) {
  const user = await prisma.user.findUnique({ where: { discordId } })
  if (!user) throw new Error('OpenSteam account not found')

  const instance = await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } })
  if (!instance?.botClientId || !instance.botSecretEnc) {
    throw new Error('Save your bot credentials on the dashboard first')
  }

  const clientSecret = decryptHostedBotSecret(instance.botSecretEnc)
  return exchangeOAuthCode({
    clientId: instance.botClientId,
    clientSecret,
    redirectUri: getCustomOAuthRedirectUrl(),
    code,
  })
}

export async function bindBrandedGuildToUser(input: {
  userId: string
  guildId: string
  accessToken?: string | null
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) {
    return { ok: false as const, error: 'OpenSteam account not found', status: 404 }
  }

  if (!canLinkBrandedHostedBot(user)) {
    return { ok: false as const, error: getBrandedLinkPlanError(user), status: 403 }
  }

  const brandedConfig = await getBrandedBotConfig()
  if (!brandedConfig.botToken) {
    return { ok: false as const, error: 'Branded bot is not configured yet', status: 503 }
  }

  const instance = await ensureBrandedHostedInstanceForUser(user)
  if (!instance) {
    return { ok: false as const, error: 'Could not create bot instance', status: 500 }
  }

  if (instance.lockedByOwner) {
    return { ok: false as const, error: 'Your bot has been locked by the platform owner', status: 403 }
  }

  const existingGuild = await prisma.hostedBotInstance.findUnique({
    where: { guildId: input.guildId },
    select: { userId: true, type: true },
  })
  const linkCheck = validateHostedGuildLink({
    actingUserId: user.id,
    targetGuildId: input.guildId,
    linkType: 'BRANDED',
    currentInstance: instance,
    existingGuildBinding: existingGuild,
  })
  if (!linkCheck.ok) {
    return { ok: false as const, error: linkCheck.error, status: linkCheck.status }
  }

  const botInGuild = await verifyBotInGuild(brandedConfig.botToken, input.guildId)
  if (!botInGuild) {
    return {
      ok: false as const,
      error: 'Bot is not in that server. Invite the bot first, then try again.',
      status: 400,
    }
  }

  const token = input.accessToken ?? user.discordAccessToken
  if (token) {
    const canManage = await verifyUserManagesGuild(token, input.guildId)
    if (!canManage) {
      return {
        ok: false as const,
        error: 'You must have Manage Server permission in that guild to bind it.',
        status: 403,
      }
    }
  }

  const inviteUrl = brandedConfig.clientId
    ? buildBotInviteUrl(brandedConfig.clientId)
    : instance.inviteUrl

  const updated = await prisma.hostedBotInstance.update({
    where: { id: instance.id },
    data: {
      guildId: input.guildId,
      status: 'ACTIVE',
      inviteUrl,
      lastStartedAt: new Date(),
    },
  })

  return { ok: true as const, instance: updated }
}

export async function bindCustomGuildToUser(input: {
  userId: string
  guildId: string
  accessToken?: string | null
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) {
    return { ok: false as const, error: 'OpenSteam account not found', status: 404 }
  }

  if (!CUSTOM_PLANS.includes(user.plan)) {
    return { ok: false as const, error: 'Custom bot requires RESELLER or BUSINESS plan', status: 403 }
  }

  if (!isHostedBotPlanActive(user)) {
    return { ok: false as const, error: 'Your plan is not active. Renew to continue.', status: 403 }
  }

  const instance = await ensureCustomHostedInstanceForUser(user)
  if (!instance) {
    return { ok: false as const, error: 'Could not create bot instance', status: 500 }
  }

  if (instance.lockedByOwner) {
    return { ok: false as const, error: 'Your bot has been locked by the platform owner', status: 403 }
  }

  if (!instance.botTokenEnc) {
    return { ok: false as const, error: 'Save your bot credentials first', status: 400 }
  }

  const existingGuild = await prisma.hostedBotInstance.findUnique({
    where: { guildId: input.guildId },
    select: { userId: true, type: true },
  })
  const linkCheck = validateHostedGuildLink({
    actingUserId: user.id,
    targetGuildId: input.guildId,
    linkType: 'CUSTOM',
    currentInstance: instance,
    existingGuildBinding: existingGuild,
  })
  if (!linkCheck.ok) {
    return { ok: false as const, error: linkCheck.error, status: linkCheck.status }
  }

  const botToken = decryptHostedBotSecret(instance.botTokenEnc)
  const botInGuild = await verifyBotInGuild(botToken, input.guildId)
  if (!botInGuild) {
    return {
      ok: false as const,
      error: 'Your bot is not in that server. Use the invite link first.',
      status: 400,
    }
  }

  const token = input.accessToken ?? user.discordAccessToken
  if (token) {
    const canManage = await verifyUserManagesGuild(token, input.guildId)
    if (!canManage) {
      return {
        ok: false as const,
        error: 'You must have Manage Server permission in that guild.',
        status: 403,
      }
    }
  }

  const updated = await prisma.hostedBotInstance.update({
    where: { id: instance.id },
    data: {
      guildId: input.guildId,
      status: 'ACTIVE',
      lastStartedAt: new Date(),
    },
  })

  return { ok: true as const, instance: updated }
}

export async function completeBrandedLinkOAuth(code: string, state: string) {
  const parsed = parseHostedLinkState(state)
  if (!parsed || parsed.type !== 'branded-link') {
    return { ok: false as const, error: 'Invalid or expired link session. Run /link again in Discord.' }
  }

  const tokens = await exchangeBrandedOAuthCode(code)

  const meRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
  if (!meRes.ok) {
    return { ok: false as const, error: 'Could not verify Discord account' }
  }

  const me = (await meRes.json()) as { id: string }
  if (me.id !== parsed.discordId) {
    return { ok: false as const, error: 'Discord account mismatch. Use the same account you use on OpenSteam.' }
  }

  const user = await prisma.user.findUnique({ where: { discordId: parsed.discordId } })
  if (!user) {
    return {
      ok: false as const,
      error: 'No OpenSteam account found. Sign in at opensteam.lol first, then run /link again.',
    }
  }

  await persistDiscordOAuthTokens(parsed.discordId, tokens.accessToken, tokens.refreshToken)

  const bind = await bindBrandedGuildToUser({
    userId: user.id,
    guildId: parsed.guildId,
    accessToken: tokens.accessToken,
  })

  if (!bind.ok) {
    return { ok: false as const, error: bind.error }
  }

  return { ok: true as const, guildId: parsed.guildId, dashboardUrl: `${getAppBaseUrl()}/dashboard?tab=bot-branded` }
}

export async function completeCustomLinkOAuth(code: string, state: string) {
  const parsed = parseHostedLinkState(state)
  if (!parsed || parsed.type !== 'custom-link') {
    return { ok: false as const, error: 'Invalid or expired link session. Run /link again in Discord.' }
  }

  const tokens = await exchangeCustomOAuthCode(code, parsed.discordId)

  const meRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
  if (!meRes.ok) {
    return { ok: false as const, error: 'Could not verify Discord account' }
  }

  const me = (await meRes.json()) as { id: string }
  if (me.id !== parsed.discordId) {
    return { ok: false as const, error: 'Discord account mismatch. Use the same account you use on OpenSteam.' }
  }

  const user = await prisma.user.findUnique({ where: { discordId: parsed.discordId } })
  if (!user) {
    return {
      ok: false as const,
      error: 'No OpenSteam account found. Sign in at opensteam.lol first, then run /link again.',
    }
  }

  await persistDiscordOAuthTokens(parsed.discordId, tokens.accessToken, tokens.refreshToken)

  const bind = await bindCustomGuildToUser({
    userId: user.id,
    guildId: parsed.guildId,
    accessToken: tokens.accessToken,
  })

  if (!bind.ok) {
    return { ok: false as const, error: bind.error }
  }

  return { ok: true as const, guildId: parsed.guildId, dashboardUrl: `${getAppBaseUrl()}/dashboard?tab=bot-custom` }
}

export function brandedOAuthResultHtml(input: { success: boolean; title: string; message: string; dashboardUrl?: string }) {
  const dashboardLink = input.dashboardUrl
    ? `<p><a href="${input.dashboardUrl}">Open dashboard</a></p>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${input.title}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0f; color: #e5e7eb; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { max-width: 420px; padding: 2rem; border-radius: 1rem; border: 1px solid ${input.success ? '#10b98155' : '#ef444455'}; background: #111827; text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; color: ${input.success ? '#34d399' : '#f87171'}; }
    p { color: #9ca3af; line-height: 1.5; }
    a { color: #818cf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${input.title}</h1>
    <p>${input.message}</p>
    ${dashboardLink}
  </div>
</body>
</html>`
}
