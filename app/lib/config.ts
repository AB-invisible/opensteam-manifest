import { Plan } from '@prisma/client'

export interface PlanLimits {
  webDaily: number
  apiDaily: number
  apiBurst: number // requests per 5s or window
  allowRyuu: boolean
  allowMorrenusFallback: boolean
}

export const PLAN_CONFIG: Record<Plan, PlanLimits> = {
  FREE: {
    webDaily: 25,
    apiDaily: 50,
    apiBurst: 30, // Increased from 10
    allowRyuu: true,
    allowMorrenusFallback: true,
  },
  REGULAR: {
    webDaily: 100,
    apiDaily: 1000,
    apiBurst: 200,  // Increased from 60
    allowRyuu: false,
    allowMorrenusFallback: false,
  },
  PREMIUM: {
    webDaily: 500,
    apiDaily: 5000,
    apiBurst: 500,   // Increased from 120
    allowRyuu: false,
    allowMorrenusFallback: false,
  },
  RESELLER: {
    webDaily: 1500,
    apiDaily: 30000,
    apiBurst: 3000,   // Increased from 1800
    allowRyuu: false,
    allowMorrenusFallback: false,
  },
  BUSINESS: {
    webDaily: 3000,
    apiDaily: 100000,
    apiBurst: 5000,   // Increased from 3000
    allowRyuu: false,
    allowMorrenusFallback: false,
  },
  CUSTOM: {
    webDaily: 10000,
    apiDaily: 1000000,
    apiBurst: 10000,  // Increased from 6000
    allowRyuu: false,
    allowMorrenusFallback: false,
  },
}

export const SYSTEM_NAMES = {
  BOT_NAME: 'OpenSteam Security Command',
  SENTINEL_ALERT_TITLE: '🛡️ Sentinel Security Alert',
  SYSTEM_NOTIFICATION_TITLE: '⚙️ System Notification',
  AUTONOMY_ENGINE_NAME: 'OpenSteam Autonomy Engine',
}

/**
 * Gets the daily web-UI generation limit for a user, respecting custom overrides.
 */
export function getWebDailyLimit(user: { plan: Plan; customWebDailyLimit?: number | null }): number {
  if (user.customWebDailyLimit !== null && user.customWebDailyLimit !== undefined) {
    return user.customWebDailyLimit
  }
  return PLAN_CONFIG[user.plan]?.webDaily || 25
}

/**
 * Gets the daily API request limit for a user, respecting custom overrides.
 */
export function getApiDailyLimit(user: { plan: Plan; customDailyLimit?: number | null }): number {
  if (user.customDailyLimit !== null && user.customDailyLimit !== undefined) {
    return user.customDailyLimit
  }
  return PLAN_CONFIG[user.plan]?.apiDaily || 15
}

/**
 * Gets the API burst limit (requests per window) for a user, respecting custom overrides.
 */
export function getApiBurstLimit(user: { plan: Plan; customMinuteLimit?: number | null }): number {
  if (user.customMinuteLimit !== null && user.customMinuteLimit !== undefined) {
    return user.customMinuteLimit
  }
  return PLAN_CONFIG[user.plan]?.apiBurst || 5
}

/**
 * Determines if a user can access Ryuu external source, respecting custom overrides.
 */
export function canAccessRyuu(user: { plan: Plan; customAllowRyuu?: boolean | null }): boolean {
  if (user.customAllowRyuu !== null && user.customAllowRyuu !== undefined) {
    return user.customAllowRyuu
  }
  return PLAN_CONFIG[user.plan]?.allowRyuu || false
}

/**
 * Determines if a user can access Morrenus fallback, respecting custom overrides.
 */
export function canUseMorrenusFallback(user: { plan: Plan; customAllowMorrenus?: boolean | null }): boolean {
  if (user.customAllowMorrenus !== null && user.customAllowMorrenus !== undefined) {
    return user.customAllowMorrenus
  }
  return PLAN_CONFIG[user.plan]?.allowMorrenusFallback || false
}

/** Google Form application grading (max points and minimum to pass). */
export const APPLICATION_MAX_SCORE = 475
export const APPLICATION_PASS_SCORE = 310
