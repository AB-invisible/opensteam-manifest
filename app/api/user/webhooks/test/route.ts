import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { sendExternalWebhook } from '@/app/lib/webhooks'
import { Plan } from '@prisma/client'

const STAFF_ROLES = new Set(['TRIAL_MODERATOR', 'MODERATOR', 'ADMIN', 'OWNER'])
const WEBHOOK_PLANS: Plan[] = ['PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { id: true, role: true, plan: true, webhookUrl: true },
  })

  if (!user?.webhookUrl) {
    return NextResponse.json({ error: 'Configure a webhook URL first.' }, { status: 400 })
  }

  const allowed = WEBHOOK_PLANS.includes(user.plan) || STAFF_ROLES.has(user.role)
  if (!allowed) {
    return NextResponse.json({ error: 'Premium plan required.' }, { status: 403 })
  }

  await sendExternalWebhook(user.id, 'GAME_GENERATED', {
    userId: user.id,
    test: true,
    message: 'OpenSteam webhook test event',
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ success: true })
}
