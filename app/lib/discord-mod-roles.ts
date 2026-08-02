import { prisma } from '@/app/lib/prisma'
import { resolveGuildBotToken } from '@/app/lib/discord-bot-credentials'
import { normalizeDiscordSnowflake } from '@/app/lib/discord-id'

/** Granted when a moderator application passes initial screening. */
export const DISCORD_TRIAL_MOD_ROLE_ID = '1497910197631582248'

/** Granted when a trial moderator passes the live assessment (replaces trial role). */
export const DISCORD_FULL_MODERATOR_ROLE_ID = '1484966440376467687'

type RoleOpResult = { ok: true } | { ok: false; error: string }

async function getGuildBotContext(): Promise<{
  guildId: string
  headers: Record<string, string>
} | null> {
  const [guildConfig, guildBot] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }),
    resolveGuildBotToken(),
  ])
  const guildId = guildConfig?.value?.trim()
  if (!guildId || !guildBot.token) return null
  return {
    guildId,
    headers: {
      Authorization: `Bot ${guildBot.token}`,
      'Content-Type': 'application/json',
    },
  }
}

function normalizeMemberId(discordIdRaw: string): string | null {
  const discordId = normalizeDiscordSnowflake(discordIdRaw) || String(discordIdRaw || '').trim()
  return discordId || null
}

async function addMemberRole(
  guildId: string,
  discordId: string,
  roleId: string,
  headers: Record<string, string>
): Promise<RoleOpResult> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: 'PUT', headers, signal: AbortSignal.timeout(10000) }
  )
  if (res.ok || res.status === 204) return { ok: true }
  const body = await res.text().catch(() => '')
  return { ok: false, error: `add role ${roleId}: ${res.status} ${body.slice(0, 200)}` }
}

async function removeMemberRole(
  guildId: string,
  discordId: string,
  roleId: string,
  headers: Record<string, string>
): Promise<RoleOpResult> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: 'DELETE', headers, signal: AbortSignal.timeout(10000) }
  )
  if (res.ok || res.status === 204) return { ok: true }
  const body = await res.text().catch(() => '')
  return { ok: false, error: `remove role ${roleId}: ${res.status} ${body.slice(0, 200)}` }
}

/** After mod application passes — add trial moderator Discord role. */
export async function grantTrialModDiscordRole(discordIdRaw: string): Promise<RoleOpResult> {
  const discordId = normalizeMemberId(discordIdRaw)
  if (!discordId) return { ok: false, error: 'Invalid Discord user id' }

  const ctx = await getGuildBotContext()
  if (!ctx) return { ok: false, error: 'Missing guild ID or bot token' }

  return addMemberRole(ctx.guildId, discordId, DISCORD_TRIAL_MOD_ROLE_ID, ctx.headers)
}

/** After trial mod test passes — swap trial role for full moderator role. */
export async function graduateTrialModDiscordRoles(discordIdRaw: string): Promise<RoleOpResult> {
  const discordId = normalizeMemberId(discordIdRaw)
  if (!discordId) return { ok: false, error: 'Invalid Discord user id' }

  const ctx = await getGuildBotContext()
  if (!ctx) return { ok: false, error: 'Missing guild ID or bot token' }

  const removed = await removeMemberRole(
    ctx.guildId,
    discordId,
    DISCORD_TRIAL_MOD_ROLE_ID,
    ctx.headers
  )
  if (!removed.ok) return removed

  return addMemberRole(ctx.guildId, discordId, DISCORD_FULL_MODERATOR_ROLE_ID, ctx.headers)
}

export function logDiscordModRoleResult(
  stage: string,
  discordId: string,
  result: RoleOpResult
): void {
  if (result.ok) return
  console.warn(`[DiscordModRoles] ${stage} failed for ${discordId}:`, result.error)
}
