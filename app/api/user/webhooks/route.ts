import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import crypto from 'crypto'
import { validateWebhookUrl } from '@/app/lib/ssrf-url'
import { Plan } from '@prisma/client'

const STAFF_ROLES = new Set(['TRIAL_MODERATOR', 'MODERATOR', 'ADMIN', 'OWNER'])
const WEBHOOK_PLANS: Plan[] = ['PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']

async function requireWebhookSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const discordId = (session.user as { discordId: string }).discordId

  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { webhookUrl: true, webhookSecret: true, role: true, plan: true },
  })

  const planAllowed = user ? WEBHOOK_PLANS.includes(user.plan) : false
  const staffAllowed = user ? STAFF_ROLES.has(user.role) : false

  if (!user || (!planAllowed && !staffAllowed)) {
    return {
      error: NextResponse.json(
        { error: 'Webhooks require Premium plan or staff access.' },
        { status: 403 }
      ),
    }
  }

  return { user, discordId }
}

/**
 * GET /api/user/webhooks
 * Fetch user's webhook configuration.
 */
export async function GET() {
  const auth = await requireWebhookSession()
  if ('error' in auth) return auth.error

  return NextResponse.json({
    webhookUrl: auth.user.webhookUrl || '',
    webhookSecret: auth.user.webhookSecret || '',
  })
}

/**
 * POST /api/user/webhooks
 * Update user's webhook configuration.
 */
export async function POST(request: NextRequest) {
  const auth = await requireWebhookSession()
  if ('error' in auth) return auth.error

  const body = await request.json().catch(() => ({}))
  const { webhookUrl, generateSecret } = body

  const updateData: { webhookUrl?: string | null; webhookSecret?: string } = {}

  if (webhookUrl !== undefined) {
    if (webhookUrl === '' || webhookUrl === null) {
      updateData.webhookUrl = null
    } else if (typeof webhookUrl === 'string') {
      const validated = validateWebhookUrl(webhookUrl)
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 })
      }
      updateData.webhookUrl = validated.url
    } else {
      return NextResponse.json({ error: 'Invalid webhook URL.' }, { status: 400 })
    }
  }

  if (generateSecret) {
    updateData.webhookSecret = crypto.randomBytes(24).toString('hex')
  }

  const updatedUser = await prisma.user.update({
    where: { discordId: auth.discordId },
    data: updateData,
    select: { webhookUrl: true, webhookSecret: true },
  })

  return NextResponse.json({
    success: true,
    webhookUrl: updatedUser.webhookUrl || '',
    webhookSecret: updatedUser.webhookSecret || '',
  })
}
