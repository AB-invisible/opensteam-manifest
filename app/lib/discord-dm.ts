import { sendBotDmWithFailover, type BotDmResult } from '@/app/lib/discord-bot-credentials'

export type { BotDmResult }

/**
 * Sends a Discord DM using the bot token (API v10). OAuth user tokens cannot DM arbitrary users.
 * Uses one active bot source; auto mode switches to backup after Discord quarantine (403/20026).
 */
export async function sendDiscordDm(discordUserId: string, content: string): Promise<BotDmResult> {
  const result = await sendBotDmWithFailover(discordUserId, content)
  if (!result.sent) {
    throw new Error(result.error ?? 'Discord DM failed')
  }
  return result
}

/** Non-throwing variant for callers that prefer a boolean/result object. */
export async function trySendDiscordDm(
  discordUserId: string,
  content: string
): Promise<BotDmResult> {
  return sendBotDmWithFailover(discordUserId, content)
}
