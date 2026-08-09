import { prisma } from '@/app/lib/prisma'
import { normalizeDiscordSnowflake } from '@/app/lib/discord-id'
import { enrichDiscordDmPayload } from '@/app/lib/anti-phishing'

export type BotTokenSource = 'primary' | 'backup'
export type FailoverMode = 'primary' | 'backup' | 'auto'

export type BotDmResult = {
  sent: boolean
  tokenUsed?: BotTokenSource
  error?: string
  quarantineDetected?: boolean
}

export type OAuthCredentials = {
  clientId: string | null
  clientSecret: string | null
  source: BotTokenSource
}

const QUARANTINE_CODES = new Set([20026])

async function getConfigValue(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  const fromDb = row?.value?.trim()
  if (fromDb) return fromDb
  const fromEnv = process.env[key]?.trim()
  return fromEnv || null
}

export async function getFailoverMode(): Promise<FailoverMode> {
  const raw = (await getConfigValue('DISCORD_BOT_FAILOVER_MODE')) || 'auto'
  if (raw === 'primary' || raw === 'backup' || raw === 'auto') return raw
  return 'auto'
}

export async function isBotQuarantined(): Promise<boolean> {
  return (await getConfigValue('DISCORD_BOT_QUARANTINED')) === 'true'
}

export async function shouldUseBackupBot(): Promise<boolean> {
  const mode = await getFailoverMode()
  if (mode === 'backup') return true
  if (mode === 'primary') return false
  return isBotQuarantined()
}

export async function resolvePrimaryBotToken(): Promise<string | null> {
  return getConfigValue('DISCORD_BOT_TOKEN')
}

export async function resolveBackupBotToken(): Promise<string | null> {
  return getConfigValue('DISCORD_BACKUP_BOT_TOKEN')
}

/** Gateway + guild slash commands always prefer the primary bot when configured. */
export async function resolveGuildBotToken(): Promise<{
  token: string | null
  source: BotTokenSource
}> {
  const primary = await resolvePrimaryBotToken()
  if (primary) return { token: primary, source: 'primary' }
  const backup = await resolveBackupBotToken()
  if (backup) return { token: backup, source: 'backup' }
  return { token: null, source: 'primary' }
}

/** Bot token paired with the active OAuth app — required for guilds.join API. */
export async function resolveGuildJoinBotToken(): Promise<{
  token: string | null
  source: BotTokenSource
}> {
  const oauth = await resolveActiveOAuthCredentials()
  if (oauth.source === 'backup') {
    const backup = await resolveBackupBotToken()
    if (backup) return { token: backup, source: 'backup' }
  }
  const primary = await resolvePrimaryBotToken()
  return { token: primary, source: 'primary' }
}

/** DM / outbound failover — backup when failover mode is active. */
export async function resolveActiveBotToken(): Promise<{
  token: string | null
  source: BotTokenSource
}> {
  const useBackup = await shouldUseBackupBot()
  if (useBackup) {
    const backup = await resolveBackupBotToken()
    return { token: backup, source: 'backup' }
  }
  const primary = await resolvePrimaryBotToken()
  return { token: primary, source: 'primary' }
}

export async function resolveAllBotTokens(): Promise<string[]> {
  const [primary, backup] = await Promise.all([
    resolvePrimaryBotToken(),
    resolveBackupBotToken(),
  ])
  const out: string[] = []
  if (primary) out.push(primary)
  if (backup && backup !== primary) out.push(backup)
  return out
}

export async function resolvePrimaryOAuthCredentials(): Promise<OAuthCredentials> {
  const [clientId, clientSecret] = await Promise.all([
    getConfigValue('DISCORD_CLIENT_ID'),
    getConfigValue('DISCORD_CLIENT_SECRET'),
  ])
  return { clientId, clientSecret, source: 'primary' }
}

async function resolveBackupOAuthCredentials(): Promise<OAuthCredentials> {
  const [clientId, clientSecret] = await Promise.all([
    getConfigValue('DISCORD_BACKUP_CLIENT_ID'),
    getConfigValue('DISCORD_BACKUP_CLIENT_SECRET'),
  ])
  return { clientId, clientSecret, source: 'backup' }
}

/** Fixed OAuth app pair — does not re-evaluate failover mode (used when source is pinned mid-flow). */
export async function resolveOAuthCredentialsBySource(
  source: BotTokenSource
): Promise<OAuthCredentials> {
  if (source === 'backup') {
    const backup = await resolveBackupOAuthCredentials()
    if (backup.clientId && backup.clientSecret) return backup
    return resolvePrimaryOAuthCredentials()
  }
  return resolvePrimaryOAuthCredentials()
}

export async function resolveActiveOAuthCredentials(): Promise<OAuthCredentials> {
  const useBackup = await shouldUseBackupBot()
  if (useBackup) {
    const backup = await resolveBackupOAuthCredentials()
    if (backup.clientId && backup.clientSecret) {
      return backup
    }
  }

  return resolvePrimaryOAuthCredentials()
}

export function parseDiscordApiErrorBody(text: string): { code?: number; message?: string } {
  try {
    const parsed = JSON.parse(text) as { code?: number; message?: string }
    return { code: parsed.code, message: parsed.message }
  } catch {
    return {}
  }
}

export function isDiscordQuarantineResponse(status: number, bodyText: string): boolean {
  if (status !== 403) return false
  const { code } = parseDiscordApiErrorBody(bodyText)
  return code !== undefined && QUARANTINE_CODES.has(code)
}

async function upsertConfig(key: string, value: string, isSecret = false) {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value, isSecret },
  })
}

async function maybePublishQuarantineBanner() {
  const autoBanner = await getConfigValue('DISCORD_AUTO_OUTAGE_BANNER')
  if (autoBanner === 'false') return

  const existing = await prisma.systemNotification.findFirst({
    where: { active: true, title: 'Discord Bot Outage' },
  })
  if (existing) return

  const { setSystemNotification } = await import('@/app/lib/notifications')
  await setSystemNotification({
    title: 'Discord Bot Outage',
    message:
      'We are experiencing Discord bot restrictions. Login and verification may use our backup bot. Moderator exam access remains available on the website.',
    type: 'error',
    active: true,
  })
}

async function maybeClearQuarantineBanner() {
  const active = await prisma.systemNotification.findFirst({
    where: { active: true, title: 'Discord Bot Outage' },
    orderBy: { createdAt: 'desc' },
  })
  if (!active) return

  await prisma.systemNotification.update({
    where: { id: active.id },
    data: { active: false },
  })
}

/** Marks main bot quarantined; auto mode will route outbound DMs to backup. */
export async function markBotQuarantined(): Promise<void> {
  const already = await isBotQuarantined()
  await upsertConfig('DISCORD_BOT_QUARANTINED', 'true')
  if (!already) {
    await maybePublishQuarantineBanner()
  }
}

/** Clears quarantine flag; explicit failover mode is left unchanged. */
export async function clearBotQuarantine(): Promise<void> {
  await upsertConfig('DISCORD_BOT_QUARANTINED', 'false')
  await maybeClearQuarantineBanner()
}

export async function setFailoverMode(mode: FailoverMode): Promise<void> {
  await upsertConfig('DISCORD_BOT_FAILOVER_MODE', mode)
  if (mode === 'primary') {
    await upsertConfig('DISCORD_BOT_QUARANTINED', 'false')
    await maybeClearQuarantineBanner()
  }
}

type DmPayload = {
  content?: string
  embeds?: unknown[]
}

async function sendDmWithToken(
  token: string,
  discordUserId: string,
  payload: DmPayload
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const recipientId = normalizeDiscordSnowflake(discordUserId) || String(discordUserId).trim()
  if (!recipientId) {
    return { ok: false, status: 0, bodyText: 'Invalid recipient ID' }
  }

  const open = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: recipientId }),
  })

  const openBody = await open.text()
  if (!open.ok) {
    return { ok: false, status: open.status, bodyText: openBody }
  }

  let channelId: string
  try {
    channelId = (JSON.parse(openBody) as { id: string }).id
  } catch {
    return { ok: false, status: open.status, bodyText: openBody }
  }

  const send = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const sendBody = await send.text()
  return { ok: send.ok, status: send.status, bodyText: sendBody }
}

/**
 * Sends a Discord DM through exactly one active source.
 * In auto mode, primary is used until Discord reports quarantine, then backup is used.
 */
export async function sendBotDmWithFailover(
  discordUserId: string,
  content: string,
  embed?: unknown,
  options?: { skipAntiPhishing?: boolean; userId?: string }
): Promise<BotDmResult> {
  let payload: DmPayload = {
    content: content || undefined,
    embeds: embed ? [embed] : undefined,
  }

  if (!options?.skipAntiPhishing) {
    payload = await enrichDiscordDmPayload(discordUserId, payload, options?.userId)
  }

  const [mode, quarantined, primary, backup] = await Promise.all([
    getFailoverMode(),
    isBotQuarantined(),
    resolvePrimaryBotToken(),
    resolveBackupBotToken(),
  ])

  const backupActive = mode === 'backup' || (mode === 'auto' && quarantined)
  if (backupActive) {
    if (!backup) {
      return { sent: false, error: 'Active Discord backup bot token is not configured' }
    }

    const result = await sendDmWithToken(backup, discordUserId, payload)
    if (result.ok) {
      return { sent: true, tokenUsed: 'backup' }
    }

    return {
      sent: false,
      tokenUsed: 'backup',
      error: `Discord DM failed: ${result.status} ${result.bodyText.slice(0, 300)}`,
    }
  }

  if (!primary) {
    return { sent: false, error: 'Active Discord primary bot token is not configured' }
  }

  const primaryResult = await sendDmWithToken(primary, discordUserId, payload)
  if (primaryResult.ok) {
    return { sent: true, tokenUsed: 'primary', quarantineDetected: false }
  }

  const quarantineDetected = isDiscordQuarantineResponse(primaryResult.status, primaryResult.bodyText)
  if (quarantineDetected) {
    await markBotQuarantined()
    if (mode === 'auto' && backup) {
      const backupResult = await sendDmWithToken(backup, discordUserId, payload)
      if (backupResult.ok) {
        return { sent: true, tokenUsed: 'backup', quarantineDetected: true }
      }

      return {
        sent: false,
        tokenUsed: 'backup',
        quarantineDetected: true,
        error: `Discord DM failed: ${backupResult.status} ${backupResult.bodyText.slice(0, 300)}`,
      }
    }
  }

  return {
    sent: false,
    tokenUsed: 'primary',
    quarantineDetected,
    error: `Discord DM failed: ${primaryResult.status} ${primaryResult.bodyText.slice(0, 300)}`,
  }
}
