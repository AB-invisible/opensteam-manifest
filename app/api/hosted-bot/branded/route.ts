import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import {
  canAccessBrandedHostedBotDashboard,
  canLinkBrandedHostedBot,
  getBrandedLinkPlanError,
  isHostedBotPlanActive,
} from '@/app/lib/hosted-bot-plans'
import {
  buildBotInviteUrl,
  ensureBrandedHostedInstanceForUser,
  getBrandedBotConfig,
  getBrandedOAuthRedirectUrl,
  serializeHostedBotInstance,
} from '@/app/lib/hosted-bot'
import { bindBrandedGuildToUser } from '@/app/lib/hosted-bot-oauth'

async function getAuthedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  return prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
}

export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!canAccessBrandedHostedBotDashboard(user)) {
    return NextResponse.json({ error: getBrandedLinkPlanError(user) }, { status: 403 })
  }

  const instance = await ensureBrandedHostedInstanceForUser(user)
  const brandedConfig = await getBrandedBotConfig()
  const inviteUrl = brandedConfig.clientId ? buildBotInviteUrl(brandedConfig.clientId) : null

  if (instance && inviteUrl && !instance.inviteUrl) {
    await prisma.hostedBotInstance.update({
      where: { id: instance.id },
      data: { inviteUrl },
    })
  }

  return NextResponse.json({
    instance: instance ? serializeHostedBotInstance(instance) : null,
    brandedConfigured: brandedConfig.hasBotToken && brandedConfig.hasClientId,
    oauthConfigured: brandedConfig.hasClientId && brandedConfig.hasClientSecret,
    inviteUrl,
    oauthRedirectUrl: getBrandedOAuthRedirectUrl(),
    planActive: isHostedBotPlanActive(user),
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  if (body.action === 'update-modules') {
    const modules = Array.isArray(body.modules) ? body.modules : []
    const updated = await prisma.hostedBotInstance.update({
      where: { userId: user.id },
      data: { modules }
    })
    return NextResponse.json({
      success: true,
      instance: serializeHostedBotInstance(updated),
    })
  }

  const guildId = String(body.guildId || '').replace(/\D/g, '')
  if (!guildId || guildId.length < 17) {
    return NextResponse.json({ error: 'Valid guild ID is required' }, { status: 400 })
  }

  const bind = await bindBrandedGuildToUser({
    userId: user.id,
    guildId,
    accessToken: user.discordAccessToken,
  })

  if (!bind.ok) {
    return NextResponse.json({ error: bind.error }, { status: bind.status })
  }

  return NextResponse.json({
    success: true,
    instance: serializeHostedBotInstance(bind.instance),
  })
}
