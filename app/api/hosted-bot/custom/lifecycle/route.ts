import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { CUSTOM_PLANS, isHostedBotPlanActive } from '@/app/lib/hosted-bot-plans'

async function getAuthedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  return prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!CUSTOM_PLANS.includes(user.plan)) {
    return NextResponse.json({ error: 'Custom bot lifecycle requires RESELLER or BUSINESS plan' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '').toLowerCase()

  if (!['start', 'stop', 'restart'].includes(action)) {
    return NextResponse.json({ error: 'action must be start, stop, or restart' }, { status: 400 })
  }

  const instance = await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } })
  if (!instance || instance.type !== 'CUSTOM') {
    return NextResponse.json({ error: 'No custom bot instance found' }, { status: 404 })
  }

  if (instance.lockedByOwner) {
    return NextResponse.json({ error: 'Your bot has been locked by the platform owner' }, { status: 403 })
  }

  if (!isHostedBotPlanActive(user) && action !== 'stop') {
    return NextResponse.json({ error: 'Your plan is not active. Renew to start your bot.' }, { status: 403 })
  }

  if (!instance.botTokenEnc && action !== 'stop') {
    return NextResponse.json({ error: 'Save bot credentials before starting' }, { status: 400 })
  }

  let status = instance.status
  const now = new Date()

  if (action === 'stop') {
    status = 'STOPPED'
    await prisma.hostedBotInstance.update({
      where: { id: instance.id },
      data: { status, lastStoppedAt: now },
    })
  } else {
    status = 'ACTIVE'
    await prisma.hostedBotInstance.update({
      where: { id: instance.id },
      data: {
        status,
        lastStartedAt: now,
        lastStoppedAt: action === 'restart' ? now : instance.lastStoppedAt,
      },
    })
  }

  return NextResponse.json({ success: true, status, action })
}
