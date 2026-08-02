import { NextRequest, NextResponse } from 'next/server'
import { verifyDiscordBotRequest } from '@/app/lib/discord-bot-auth'
import { createVerificationSession } from '@/app/lib/discord-verify-session'
import { getDiscordVerifyConfig } from '@/app/lib/discord-verify-config'

export const dynamic = 'force-dynamic'

/** Main OpenSteam bot only (DISCORD_BOT_TOKEN) — not hosted/custom bots. */
export async function POST(request: NextRequest) {
  if (!(await verifyDiscordBotRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = await getDiscordVerifyConfig()
  if (!config.enabled) {
    return NextResponse.json({ error: 'Verification is disabled' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const discordId = String(body.discordId || '').trim()
  const guildId = String(body.guildId || config.guildId || '').trim()

  if (!discordId || !guildId) {
    return NextResponse.json({ error: 'discordId and guildId are required' }, { status: 400 })
  }

  const { url, signed } = await createVerificationSession(discordId, guildId)
  return NextResponse.json({ url, signed })
}
