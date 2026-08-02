import { resolveAllBotTokens } from '@/app/lib/discord-bot-credentials'
import { safeKeyEquals } from '@/app/lib/safe-compare'
import { parseBearerToken } from '@/app/lib/bearer-auth'

export async function verifyDiscordBotRequest(request: Request): Promise<boolean> {
  const presented = parseBearerToken(request.headers.get('authorization'))
  if (!presented) return false

  const tokens = await resolveAllBotTokens()
  return tokens.some((token) => safeKeyEquals(presented, token))
}
