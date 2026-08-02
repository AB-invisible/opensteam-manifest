import { Plan } from '@prisma/client'
import { PLAN_CONFIG } from '@/app/lib/config'
import { prisma } from '@/app/lib/prisma'

export const ALL_PLANS: Plan[] = ['FREE', 'REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']

export const PLAN_LABELS: Record<Plan, string> = {
  FREE: 'Free',
  REGULAR: 'Regular',
  PREMIUM: 'Premium',
  RESELLER: 'Reseller',
  BUSINESS: 'Business',
  CUSTOM: 'Custom',
}

const PLAN_TIER: Record<Plan, number> = {
  FREE: 0,
  REGULAR: 1,
  PREMIUM: 2,
  RESELLER: 3,
  BUSINESS: 4,
  CUSTOM: 5,
}

export function getAdminPlanOptions() {
  return ALL_PLANS.map((plan) => ({
    value: plan,
    label: PLAN_LABELS[plan],
    limits: PLAN_CONFIG[plan],
  }))
}

export function isValidPlan(value: unknown): value is Plan {
  return typeof value === 'string' && ALL_PLANS.includes(value as Plan)
}

export function computePlanExpiry(input: {
  plan: Plan
  indefinite?: boolean
  months?: number
  expiryDate?: string | null
  currentPlan?: Plan
  currentExpiry?: Date | null
}): Date | null {
  if (input.plan === 'FREE') return null
  if (input.indefinite) return null

  if (input.expiryDate) {
    const explicit = new Date(input.expiryDate)
    if (Number.isNaN(explicit.getTime())) {
      throw new Error('Invalid expiry date.')
    }
    return explicit
  }

  const months = input.months ?? 1
  if (!Number.isFinite(months) || months < 1 || months > 120) {
    throw new Error('Duration must be between 1 and 120 months.')
  }

  let base = new Date()
  if (
    input.currentPlan === input.plan &&
    input.currentExpiry &&
    new Date(input.currentExpiry) > base
  ) {
    base = new Date(input.currentExpiry)
  }

  const next = new Date(base)
  next.setMonth(next.getMonth() + Math.round(months))
  return next
}

export async function findUserByIdentifier(identifier: string) {
  const trimmed = identifier.trim()
  if (!trimmed) return null

  const byId = await prisma.user.findUnique({
    where: { id: trimmed },
    select: {
      id: true,
      discordId: true,
      username: true,
      plan: true,
      planExpiry: true,
      role: true,
    },
  })
  if (byId) return byId

  return prisma.user.findUnique({
    where: { discordId: trimmed },
    select: {
      id: true,
      discordId: true,
      username: true,
      plan: true,
      planExpiry: true,
      role: true,
    },
  })
}

export async function applyAdminPlanUpgrade(params: {
  callerId: string
  targetUserId: string
  plan: Plan
  planExpiry: Date | null
  ip?: string | null
}) {
  const userBefore = await prisma.user.findUnique({
    where: { id: params.targetUserId },
    select: { plan: true },
  })
  if (!userBefore) throw new Error('User not found.')

  const updatedUser = await prisma.user.update({
    where: { id: params.targetUserId },
    data: {
      plan: params.plan,
      planExpiry: params.planExpiry,
      planIsCanceled: false,
    },
  })

  if (params.plan !== userBefore.plan) {
    const { upsertHostedBotInstanceForUser, suspendHostedBotInstance } = await import('@/app/lib/hosted-bot')
    const { getHostedBotTypeForPlan } = await import('@/app/lib/hosted-bot-plans')

    if (getHostedBotTypeForPlan(updatedUser.plan as Plan)) {
      await upsertHostedBotInstanceForUser(updatedUser.id, updatedUser.plan as Plan).catch((err) =>
        console.error('[AdminPlanUpgrade] Hosted bot upsert failed:', err)
      )
    } else {
      await suspendHostedBotInstance(updatedUser.id, true).catch((err) =>
        console.error('[AdminPlanUpgrade] Hosted bot suspend failed:', err)
      )
    }

    const { notifyPlanUpgrade, notifyPlanDowngrade } = await import('@/app/lib/email')
    const isDowngrade = PLAN_TIER[params.plan] < PLAN_TIER[userBefore.plan as Plan]

    if (isDowngrade) {
      await notifyPlanDowngrade(updatedUser.id, params.plan)
    } else {
      await notifyPlanUpgrade(updatedUser.id, params.plan, updatedUser.planExpiry)
    }
  }

  const details = `Plan: ${updatedUser.plan}, Expiry: ${updatedUser.planExpiry?.toISOString() ?? 'none'}`

  const { sendWebhook } = await import('@/app/lib/webhooks')
  sendWebhook('ADMIN_ACTION', {
    action: 'PLAN_UPGRADE',
    username: updatedUser.username,
    userId: updatedUser.id,
    details,
  })

  const { createAuditLog } = await import('@/app/lib/audit')
  await createAuditLog(params.callerId, 'PLAN_UPGRADE', updatedUser.id, details, params.ip ?? 'AdminPanel')

  return updatedUser
}
