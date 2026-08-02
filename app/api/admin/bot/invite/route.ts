import { authOptions } from '@/app/lib/auth-options'
import { getAppBaseUrl } from '@/app/lib/hosted-bot'
import {
  getMainBotClientId,
  resolveMainBotInviteUrl,
} from '@/app/lib/main-bot-invite'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { id: true, role: true, username: true },
  })

  if (!user || user.role !== 'OWNER') return null
  return user
}

/**
 * Owner-only gateway for the main OpenSteam Discord bot invite.
 * Does not expose DISCORD_CLIENT_ID in the admin UI — use this endpoint instead of a public Discord URL.
 *
 * GET /api/admin/bot/invite?redirect=1          → 302 to Discord OAuth authorize
 * GET /api/admin/bot/invite?format=json         → { inviteEndpoint, configured, guildId? }
 * GET /api/admin/bot/invite?format=json&includeUrl=1 → also returns discordInviteUrl (owner session only)
 */
export async function GET(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) {
    return NextResponse.json({ error: 'Forbidden — owner role required' }, { status: 403 })
  }

  const clientId = await getMainBotClientId()
  if (!clientId) {
    return NextResponse.json(
      { error: 'Main bot is not configured — set DISCORD_CLIENT_ID in Settings' },
      { status: 503 }
    )
  }

  const guildId = request.nextUrl.searchParams.get('guild_id')?.replace(/\D/g, '') || undefined
  const discordInviteUrl = await resolveMainBotInviteUrl(guildId)
  if (!discordInviteUrl) {
    return NextResponse.json({ error: 'Could not build invite URL' }, { status: 500 })
  }

  const wantsRedirect = request.nextUrl.searchParams.get('redirect') === '1'
  const wantsJson =
    request.nextUrl.searchParams.get('format') === 'json' ||
    request.headers.get('accept')?.includes('application/json')

  if (wantsRedirect && !wantsJson) {
    return NextResponse.redirect(discordInviteUrl)
  }

  const baseUrl = getAppBaseUrl().replace(/\/$/, '')
  const inviteEndpoint = `${baseUrl}/api/admin/bot/invite?redirect=1${
    guildId ? `&guild_id=${guildId}` : ''
  }`

  const payload: Record<string, unknown> = {
    inviteEndpoint,
    configured: true,
    permissions: 8,
    scope: 'bot applications.commands',
    requestedBy: owner.username,
  }

  if (guildId) payload.guildId = guildId

  if (request.nextUrl.searchParams.get('includeUrl') === '1') {
    payload.discordInviteUrl = discordInviteUrl
  }

  return NextResponse.json(payload)
}
