import { resolveActiveOAuthCredentials, resolveGuildBotToken } from '@/app/lib/discord-bot-credentials'
import { resolvePublicAppUrl } from '@/app/lib/public-app-url'
import { prisma } from '@/app/lib/prisma'

export const VERIFY_DEFAULTS = {
  UNVERIFIED_ROLE_ID: '1505832860035059742',
  VERIFIED_ROLE_ID: '1473719437692637288',
  VERIFY_CHANNEL_ID: '1532910591264423988',
  VERIFY_BANNER_URL: `${resolvePublicAppUrl()}/opensteam.png`,
} as const

export type DiscordVerifyConfig = {
  enabled: boolean
  guildId: string | null
  unverifiedRoleId: string
  verifiedRoleId: string
  verifyChannelId: string
  verifyBannerUrl: string
  verifyMessageId: string | null
  botToken: string | null
  clientId: string | null
  clientSecret: string | null
  alertsChannelId: string | null
}

async function getConfigValue(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value || process.env[key] || null
}

export async function getDiscordVerifyConfig(): Promise<DiscordVerifyConfig> {
  const [
    enabled,
    guildId,
    unverifiedRoleId,
    verifiedRoleId,
    verifyChannelId,
    verifyBannerUrl,
    verifyMessageId,
    backupVerifyMessageId,
    alertsChannelId,
    oauth,
    bot,
  ] = await Promise.all([
    getConfigValue('DISCORD_VERIFY_ENABLED'),
    getConfigValue('DISCORD_GUILD_ID'),
    getConfigValue('DISCORD_UNVERIFIED_ROLE_ID'),
    getConfigValue('DISCORD_VERIFIED_ROLE_ID'),
    getConfigValue('DISCORD_VERIFY_CHANNEL_ID'),
    getConfigValue('DISCORD_VERIFY_BANNER_URL'),
    getConfigValue('DISCORD_VERIFY_MESSAGE_ID'),
    getConfigValue('DISCORD_BACKUP_VERIFY_MESSAGE_ID'),
    getConfigValue('DISCORD_ALERTS_CHANNEL_ID'),
    resolveActiveOAuthCredentials(),
    resolveGuildBotToken(),
  ])

  const activeVerifyMessageId =
    bot.source === 'backup' && backupVerifyMessageId ? backupVerifyMessageId : verifyMessageId

  return {
    enabled: enabled !== 'false',
    guildId,
    unverifiedRoleId: unverifiedRoleId || VERIFY_DEFAULTS.UNVERIFIED_ROLE_ID,
    verifiedRoleId: verifiedRoleId || VERIFY_DEFAULTS.VERIFIED_ROLE_ID,
    verifyChannelId: verifyChannelId || VERIFY_DEFAULTS.VERIFY_CHANNEL_ID,
    verifyBannerUrl: verifyBannerUrl || VERIFY_DEFAULTS.VERIFY_BANNER_URL,
    verifyMessageId: activeVerifyMessageId,
    botToken: bot.token,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    alertsChannelId,
  }
}

export function getAppBaseUrl(): string {
  return resolvePublicAppUrl()
}
