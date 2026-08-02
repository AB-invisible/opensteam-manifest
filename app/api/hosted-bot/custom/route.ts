import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import {
  CUSTOM_PLANS,
  isBusinessPlanActive,
  isHostedBotPlanActive,
} from '@/app/lib/hosted-bot-plans'
import {
  buildBotInviteUrl,
  ensureCustomHostedInstanceForUser,
  getCustomOAuthRedirectUrl,
  saveCustomBotCredentials,
  serializeHostedBotInstance,
} from '@/app/lib/hosted-bot'
import { bindCustomGuildToUser } from '@/app/lib/hosted-bot-oauth'

async function getAuthedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  return prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
}

export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!CUSTOM_PLANS.includes(user.plan)) {
    return NextResponse.json({ error: 'Custom bot requires RESELLER or BUSINESS plan' }, { status: 403 })
  }

  const instance = await ensureCustomHostedInstanceForUser(user)

  return NextResponse.json({
    instance: instance ? serializeHostedBotInstance(instance, { includeClientId: true }) : null,
    oauthRedirectUrl: getCustomOAuthRedirectUrl(),
    oauthConfigured: !!(instance?.botClientId && instance.botSecretEnc),
    planActive: isHostedBotPlanActive(user),
    planExpiry: user.planExpiry,
    planIsCanceled: user.planIsCanceled,
    businessActive: user.plan !== 'BUSINESS' || isBusinessPlanActive(user),
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!CUSTOM_PLANS.includes(user.plan)) {
    return NextResponse.json({ error: 'Custom bot requires RESELLER or BUSINESS plan' }, { status: 403 })
  }

  if (!isHostedBotPlanActive(user)) {
    return NextResponse.json({ error: 'Your plan is not active. Renew to continue.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action as string | undefined

  const existing = await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } })
  if (existing?.lockedByOwner) {
    return NextResponse.json({ error: 'Your bot has been locked by the platform owner' }, { status: 403 })
  }

  if (action === 'save-credentials') {
    const botToken = String(body.botToken || '').trim()
    const clientId = String(body.clientId || '').trim()
    const clientSecret = String(body.clientSecret || '').trim()
    const hasExisting = !!(
      existing?.botTokenEnc &&
      existing?.botSecretEnc &&
      existing?.botClientId
    )

    if (!clientId && !hasExisting) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 })
    }
    if (!hasExisting && (!botToken || !clientSecret)) {
      return NextResponse.json({ error: 'Bot token, client ID, and client secret are required' }, { status: 400 })
    }

    try {
      const updated = await saveCustomBotCredentials(user.id, { botToken, clientId, clientSecret })
      return NextResponse.json({
        success: true,
        instance: serializeHostedBotInstance(updated, { includeClientId: true }),
        oauthRedirectUrl: getCustomOAuthRedirectUrl(),
        inviteUrl: buildBotInviteUrl(updated.botClientId || clientId),
      })
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'Failed to save credentials' }, { status: 500 })
    }
  }

  if (action === 'bind-guild') {
    const instance = await ensureCustomHostedInstanceForUser(user)
    if (!instance) {
      return NextResponse.json({ error: 'Could not create bot instance' }, { status: 500 })
    }

    const guildId = String(body.guildId || '').replace(/\D/g, '')
    if (!guildId || guildId.length < 17) {
      return NextResponse.json({ error: 'Valid guild ID is required' }, { status: 400 })
    }

    const bind = await bindCustomGuildToUser({
      userId: user.id,
      guildId,
      accessToken: user.discordAccessToken,
    })

    if (!bind.ok) {
      return NextResponse.json({ error: bind.error }, { status: bind.status })
    }

    return NextResponse.json({
      success: true,
      instance: serializeHostedBotInstance(bind.instance, { includeClientId: true }),
    })
  }

  if (action === 'update-modules') {
    const modules = Array.isArray(body.modules) ? body.modules : []
    const updated = await prisma.hostedBotInstance.update({
      where: { userId: user.id },
      data: { modules }
    })
    return NextResponse.json({
      success: true,
      instance: serializeHostedBotInstance(updated, { includeClientId: true }),
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
