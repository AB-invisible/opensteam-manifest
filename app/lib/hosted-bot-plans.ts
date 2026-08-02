import { HostedBotType, Plan, Role } from '@prisma/client'
import { getApiDailyLimit, getWebDailyLimit } from './config'

export const BRANDED_PLANS: Plan[] = ['REGULAR', 'PREMIUM']
export const CUSTOM_PLANS: Plan[] = ['RESELLER', 'BUSINESS']

type PlanUser = {
  plan: Plan
  role?: Role | string | null
  planExpiry?: Date | null
  planIsCanceled?: boolean
  isBanned?: boolean
}

export function isPlatformOwner(user: Pick<PlanUser, 'role'>): boolean {
  return user.role === 'OWNER'
}

export function canLinkBrandedHostedBot(user: PlanUser): boolean {
  if (user.isBanned) return false
  if (isPlatformOwner(user)) return true
  if (!BRANDED_PLANS.includes(user.plan)) return false
  return isHostedBotPlanActive(user)
}

export function canAccessBrandedHostedBotDashboard(user: PlanUser): boolean {
  return canLinkBrandedHostedBot(user)
}

export function getBrandedLinkPlanError(user: Pick<PlanUser, 'plan'>): string {
  if (user.plan === 'RESELLER' || user.plan === 'BUSINESS') {
    return (
      'Your **RESELLER/BUSINESS** plan uses a **Custom Bot** (your own Discord app), not the shared branded bot. ' +
      'Open **Dashboard → Custom Bot** and run `/link` on your bot instead.'
    )
  }
  if (user.plan === 'FREE') {
    return (
      'Branded bot requires a **REGULAR** or **PREMIUM** plan. Upgrade at http://127.0.0.1:3000/pricing, ' +
      'then run `/link` with the **same Discord account** you use on OpenSteam. ' +
      'If someone else bought the plan, they must run `/link` in this server.'
    )
  }
  return (
    `Branded bot requires **REGULAR** or **PREMIUM** (your plan: **${user.plan}**). ` +
    'Visit http://127.0.0.1:3000/pricing or contact support if you already paid.'
  )
}

export function resolveHostedInstancePlan(user: PlanUser): Plan | null {
  if (isPlanEligibleForHostedBot(user.plan)) return user.plan
  if (isPlatformOwner(user)) return 'REGULAR'
  return null
}

export function resolveBrandedHostedInstancePlan(user: PlanUser): Plan | null {
  if (BRANDED_PLANS.includes(user.plan)) return user.plan
  if (isPlatformOwner(user)) return 'REGULAR'
  return null
}

export function resolveCustomHostedInstancePlan(user: Pick<PlanUser, 'plan'>): Plan | null {
  if (CUSTOM_PLANS.includes(user.plan)) return user.plan
  return null
}

export function getHostedBotTypeForPlan(plan: Plan): HostedBotType | null {
  if (BRANDED_PLANS.includes(plan)) return 'BRANDED'
  if (CUSTOM_PLANS.includes(plan)) return 'CUSTOM'
  return null
}

export function isPlanEligibleForHostedBot(plan: Plan): boolean {
  return getHostedBotTypeForPlan(plan) !== null
}

export function getHostedGenDailyLimit(
  user: {
    plan: Plan
    customWebDailyLimit?: number | null
    customDailyLimit?: number | null
  },
  useApiLimit: boolean
): number {
  if (useApiLimit) return getApiDailyLimit(user)
  return getWebDailyLimit(user)
}

export function isBusinessPlanActive(user: {
  plan: Plan
  planExpiry?: Date | null
  planIsCanceled?: boolean
}): boolean {
  if (user.plan !== 'BUSINESS') return true
  if (user.planIsCanceled) return false
  if (user.planExpiry && user.planExpiry < new Date()) return false
  return true
}

export function getHostedBotAllowedCommands(plan: Plan): string[] {
  const base = ['gen', 'help']
  if (CUSTOM_PLANS.includes(plan) || plan === 'CUSTOM') {
    return [...base, 'status', 'link', 'drop']
  }
  if (BRANDED_PLANS.includes(plan)) {
    return [...base, 'status', 'link']
  }
  return base
}

export function isHostedBotPlanActive(user: {
  plan: Plan
  planExpiry?: Date | null
  planIsCanceled?: boolean
}): boolean {
  if (!isPlanEligibleForHostedBot(user.plan)) return false
  if (user.plan === 'BUSINESS') return isBusinessPlanActive(user)
  return true
}
