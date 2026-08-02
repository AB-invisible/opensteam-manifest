import { NextRequest, NextResponse } from 'next/server'
import { verifyDiscordBotRequest } from '@/app/lib/discord-bot-auth'
import { notifyGuildJoinWelcome } from '@/app/lib/discord-guild-join-welcome'

export async function POST(request: NextRequest) {
  if (!(await verifyDiscordBotRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const discordId = body.discordId != null ? String(body.discordId) : ''
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const isRejoin = Boolean(body.isRejoin)

  if (!discordId) {
    return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })
  }
  if (!username) {
    return NextResponse.json({ error: 'Missing username' }, { status: 400 })
  }

  const result = await notifyGuildJoinWelcome({ discordId, username, isRejoin })
  return NextResponse.json({ success: true, ...result })
}
