import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { CUSTOM_PLANS, isHostedBotPlanActive } from '@/app/lib/hosted-bot-plans'
import { ensureCustomHostedInstanceForUser, validateHostedGuildLink } from '@/app/lib/hosted-bot'
import { buildCustomLinkOAuthUrl } from '@/app/lib/hosted-bot-oauth'

async function getAuthedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  return prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
}

export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!CUSTOM_PLANS.includes(user.plan)) {
    return NextResponse.json({ error: 'Custom bot requires RESELLER or BUSINESS plan' }, { status: 403 })
  }

  if (!isHostedBotPlanActive(user)) {
    return NextResponse.json({ error: 'Your plan is not active' }, { status: 403 })
  }

  const guildId = String(req.nextUrl.searchParams.get('guildId') || '').replace(/\D/g, '')
  if (!guildId || guildId.length < 17) {
    return NextResponse.json({ error: 'Valid guildId query parameter is required' }, { status: 400 })
  }

  const instance = await ensureCustomHostedInstanceForUser(user)
  if (!instance?.botClientId || !instance.botSecretEnc) {
    return NextResponse.json({ error: 'Save your bot credentials on the dashboard first' }, { status: 400 })
  }

  const existingGuild = await prisma.hostedBotInstance.findUnique({
    where: { guildId },
    select: { userId: true, type: true },
  })
  const linkCheck = validateHostedGuildLink({
    actingUserId: user.id,
    targetGuildId: guildId,
    linkType: 'CUSTOM',
    currentInstance: instance,
    existingGuildBinding: existingGuild,
  })
  if (!linkCheck.ok) {
    return NextResponse.json({ error: linkCheck.error }, { status: linkCheck.status })
  }

  const oauthUrl = buildCustomLinkOAuthUrl({
    clientId: instance.botClientId,
    guildId,
    discordId: user.discordId,
  })

  return NextResponse.json({ oauthUrl, guildId })
}
