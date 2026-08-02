import { prisma } from './prisma'

/** Administrator — matches legacy admin panel main-bot invite. */
export const MAIN_BOT_INVITE_PERMISSIONS = 8

export async function getMainBotClientId(): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_CLIENT_ID' } })
  const clientId = (process.env.DISCORD_CLIENT_ID || config?.value || '').trim()
  return clientId || null
}

export async function getMainBotGuildId(): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } })
  const guildId = (config?.value || process.env.DISCORD_GUILD_ID || '').trim()
  return guildId || null
}

export function buildMainBotInviteUrl(clientId: string, guildId?: string | null): string {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: String(MAIN_BOT_INVITE_PERMISSIONS),
    scope: 'bot applications.commands',
  })
  if (guildId) params.set('guild_id', guildId)
  return `https://discord.com/oauth2/authorize?${params.toString()}`
}

export async function resolveMainBotInviteUrl(guildId?: string | null): Promise<string | null> {
  const clientId = await getMainBotClientId()
  if (!clientId) return null
  const resolvedGuildId = guildId?.trim() || (await getMainBotGuildId())
  return buildMainBotInviteUrl(clientId, resolvedGuildId)
}
