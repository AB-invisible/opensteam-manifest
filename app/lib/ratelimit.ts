import type { Plan } from '@prisma/client'
import { prisma } from './prisma'
import { getApiDailyLimit, getWebDailyLimit } from './config'

/**
 * Persisted rate limiter using PostgreSQL.
 * Replaces the previous in-memory Map storage for jails and quotas.
 */

// Memory cache for the hard blacklist only (refreshed periodically)
let BLACKLIST = new Set<string>([])

export async function refreshBlacklist() {
  try {
    const ips = await (prisma as any).blacklistedIp.findMany({ select: { ip: true } })
    BLACKLIST = new Set(ips.map((b: any) => b.ip))
  } catch (e) {
    console.error('Failed to refresh blacklist:', e)
  }
}

// Initial refresh — use globalThis to prevent interval leaks during dev hot reloads
const globalForBlacklist = globalThis as unknown as { _blacklistInterval?: ReturnType<typeof setInterval> }
if (globalForBlacklist._blacklistInterval) {
  clearInterval(globalForBlacklist._blacklistInterval)
}
refreshBlacklist()
globalForBlacklist._blacklistInterval = setInterval(refreshBlacklist, 300000) // 5 minutes

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
  errorReason?: string
  isAutoDisabled?: boolean
  isScraperDetected?: boolean
}

/** Per-UTC-day plan quota (distinct from burst / hourly velocity). */
export interface DailyQuotaResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
  errorReason?: string
}

function endOfUtcDayResetMs(from: Date): number {
  const t = new Date(from)
  t.setUTCHours(24, 0, 0, 0)
  return Math.ceil(t.getTime() / 1000)
}

/**
 * Burst + hourly velocity only (abuse / fairness). Does not enforce daily plan quota.
 * Shared across all API keys for the same user.
 */
export async function checkVelocityRateLimit(
  userId: string,
  maxHourly: number,
  maxBurst: number = 30,
  ip: string = 'unknown',
  appId?: string,
  bypassSecurity: boolean = false
): Promise<RateLimitResult> {
  const now = new Date()
  const nowMs = now.getTime()
  const todayStr = now.toISOString().split('T')[0]
  const hourMs = 3600000

  // 0. Global Firewall (Blacklist) - Still using cached SET for extreme performance
  if (BLACKLIST.has(ip)) {
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      resetAt: Math.ceil((nowMs + hourMs) / 1000),
      errorReason: 'Your IP has been permanently blacklisted by the OpenSteam Firewall.'
    }
  }

  // 1. Fetch persistent states
  const [state, ipState] = await Promise.all([
    (prisma as any).rateLimitState.upsert({
      where: { key: userId },
      create: { key: userId, type: 'USER', resetDate: todayStr },
      update: {}
    }),
    ip !== 'unknown' ? (prisma as any).rateLimitState.upsert({
      where: { key: ip },
      create: { key: ip, type: 'IP', resetDate: todayStr },
      update: {}
    }) : Promise.resolve(null)
  ])

  // 2. IP Jail check
  if (ipState && ipState.blockedUntil && ipState.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      resetAt: Math.ceil(ipState.blockedUntil.getTime() / 1000),
      errorReason: `IP Jail: Too many violations. Blocked for ${Math.ceil((ipState.blockedUntil.getTime() - nowMs) / 60000)} more minutes.`
    }
  }

  // 3. User check
  if (state.blockedUntil && state.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      limit: maxHourly,
      resetAt: Math.ceil(state.blockedUntil.getTime() / 1000),
      errorReason: 'Abuse detected. Account temporarily suspended from API access.'
    }
  }

  // 4–5. Hourly window + burst (~60s) in one round-trip (all usage rows across all user keys).
  const hourAgo = new Date(nowMs - hourMs)
  const minuteAgo = new Date(nowMs - 60000)

  const usageAggRows = await prisma.$queryRaw<{ hourly_all: bigint; minute_all: bigint }[]>`
    SELECT
      COUNT(*) FILTER (WHERE u."createdAt" >= ${hourAgo})::bigint AS hourly_all,
      COUNT(*) FILTER (WHERE u."createdAt" >= ${minuteAgo})::bigint AS minute_all
    FROM api_usage u
    INNER JOIN api_keys k ON u."apiKeyId" = k.id
    WHERE k."userId" = ${userId}
  `
  const usageAgg = usageAggRows[0]
  const hourlyCount = Number(usageAgg?.hourly_all ?? 0)
  const minuteCount = Number(usageAgg?.minute_all ?? 0)

  // 6. Scraper Detection (Unusual variety of AppIDs)
  if (appId && !bypassSecurity) {
    const thirtyMinAgo = new Date(nowMs - 1800000)
    const uniqueAppIds = await (prisma.apiUsage as any).groupBy({
      by: ['requestedAppId'],
      where: {
        apiKey: { userId },
        createdAt: { gte: thirtyMinAgo },
        requestedAppId: { not: null }
      }
    })

    if (uniqueAppIds.length > 2500) {
      await (prisma as any).rateLimitState.update({
        where: { id: state.id },
        data: { abuseScore: state.abuseScore + 0.1 }
      }).catch(() => { })
    }
  }

  // 7. Violation Handling (Minute/Burst)
  const activeBurstThreshold = Math.max(
    1,
    Math.floor(bypassSecurity ? maxBurst * 1.5 : maxBurst)
  )
  if (minuteCount >= activeBurstThreshold) {
    if (bypassSecurity) {
      return {
        allowed: false,
        remaining: 0,
        limit: maxHourly,
        resetAt: Math.ceil(nowMs / 1000) + 10,
        errorReason: `Rate limit burst: Please slow down.`
      }
    }

    const newAbuseScore = state.abuseScore + 1
    const updates: any = { abuseScore: newAbuseScore, lastUpdate: now }

    if (ipState) {
      const newViolationCount = ipState.violationCount + 1
      const ipUpdates: any = { violationCount: newViolationCount }

      if (newViolationCount >= 10) {
        const ipJailUntil = new Date(nowMs + (5 * 60 * 1000))
        ipUpdates.blockedUntil = ipJailUntil
        ipUpdates.violationCount = 0

        // Trigger rate limit jail email
        import('./email').then(({ sendRateLimitJailEmail }) => {
          sendRateLimitJailEmail(userId, ipJailUntil, 'Too many rate limit violations on your client IP address.').catch(() => {});
        }).catch(() => {});
      }
      await (prisma as any).rateLimitState.update({ where: { id: ipState.id }, data: ipUpdates })
    }

    if (newAbuseScore >= 15) {
      const userSuspendedUntil = new Date(nowMs + (60 * 60 * 1000)) // 1 hour suspension
      updates.blockedUntil = userSuspendedUntil
      updates.abuseScore = 0 // Reset abuse score for the next cycle
      await (prisma as any).rateLimitState.update({ where: { id: state.id }, data: updates })

      // Trigger suspension email
      import('./email').then(({ sendRateLimitJailEmail }) => {
        sendRateLimitJailEmail(userId, userSuspendedUntil, 'Extreme API abuse velocity and pattern violations detected.').catch(() => {});
      }).catch(() => {});

      return {
        allowed: false,
        remaining: 0,
        limit: maxHourly,
        resetAt: Math.ceil(userSuspendedUntil.getTime() / 1000),
        errorReason: 'Extreme Abuse Detected: API access disabled by Autonomy Engine.',
        isAutoDisabled: true
      }
    }

    updates.blockedUntil = new Date(nowMs + (30 * 1000))
    await (prisma as any).rateLimitState.update({ where: { id: state.id }, data: updates })

    return {
      allowed: false,
      remaining: 0,
      limit: maxHourly,
      resetAt: Math.ceil(nowMs / 1000) + 30,
      errorReason: `Rate limit burst detection: Please slow down. (Score: ${Math.floor(newAbuseScore)}/15)`
    }
  }

  // 8. Hourly Rate Limit Check
  if (hourlyCount >= maxHourly) {
    return {
      allowed: false,
      remaining: 0,
      limit: maxHourly,
      resetAt: Math.ceil((nowMs + hourMs) / 1000),
      errorReason: 'Hourly rate limit exceeded.'
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxHourly - hourlyCount),
    limit: maxHourly,
    resetAt: Math.ceil((nowMs + hourMs) / 1000)
  }
}

/** Normalized api_usage paths that consume a daily manifest generation. */
export function isBillableGenerationEndpoint(endpoint: string): boolean {
  return (
    endpoint.includes('/generate/') ||
    endpoint.endsWith('/bulk/generate') ||
    endpoint === '/api/manifests/generate'
  )
}

const billableGenerationEndpointFilter = {
  OR: [
    { endpoint: { contains: '/generate/' } },
    { endpoint: { endsWith: '/bulk/generate' } },
    { endpoint: '/api/manifests/generate' },
  ],
} as const

/** Manifest generations consumed today (billable API calls only). */
export async function countDailyBillableGenerations(userId: string): Promise<number> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  return prisma.apiUsage.count({
    where: {
      apiKey: { userId },
      createdAt: { gte: todayStart },
      status: { not: 429 },
      ...billableGenerationEndpointFilter,
    },
  })
}

/**
 * Per-day plan quota: manifest generations since UTC midnight.
 * Counts billable api_usage rows (generate endpoints) shared across all API keys.
 */
export async function checkDailyApiQuota(
  userId: string,
  dailyLimit: number,
  opts?: { enforce?: boolean }
): Promise<DailyQuotaResult> {
  const enforce = opts?.enforce !== false
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const resetAt = endOfUtcDayResetMs(now)

  const used = await countDailyBillableGenerations(userId)

  const remaining = Math.max(0, dailyLimit - used)
  if (enforce && used >= dailyLimit) {
    return {
      allowed: false,
      remaining: 0,
      limit: dailyLimit,
      resetAt,
      errorReason: `Daily limit of ${dailyLimit} generations exceeded for your account.`
    }
  }
  return { allowed: true, remaining, limit: dailyLimit, resetAt }
}

export interface WebDailyQuotaResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
  todayCount: number
  errorReason?: string
}

/** Per-UTC-day web UI generation quota (webGeneration rows). */
export async function checkWebDailyQuota(
  userId: string,
  userForLimit: { plan: Plan; customWebDailyLimit?: number | null }
): Promise<WebDailyQuotaResult> {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setUTCHours(0, 0, 0, 0)
  const resetAt = endOfUtcDayResetMs(now)
  const limit = getWebDailyLimit(userForLimit)

  const todayCount = await prisma.webGeneration.count({
    where: { userId, createdAt: { gte: todayStart } },
  })

  const remaining = Math.max(0, limit - todayCount)
  if (todayCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      todayCount,
      errorReason: `Daily web generation limit reached (${todayCount}/${limit}). Resets at midnight UTC.`,
    }
  }

  return { allowed: true, remaining, limit, resetAt, todayCount }
}

export function webQuotaHeaders(result: WebDailyQuotaResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Web-Daily-Limit': String(result.limit),
    'X-Web-Daily-Remaining': String(result.remaining),
    'X-Web-Daily-Reset': String(result.resetAt),
  }
  if (result.errorReason) {
    headers['X-Web-Daily-Error'] = result.errorReason
  }
  return headers
}

/** Sum of remaining successful API calls today for the user (shared across all keys). */
export async function sumApiQuotaRemainingAcrossKeys(
  userId: string,
  userForLimit: { plan: Plan; customDailyLimit?: number | null }
): Promise<{ totalRemaining: number; keyCount: number }> {
  const dailyLimit = getApiDailyLimit(userForLimit)
  const q = await checkDailyApiQuota(userId, dailyLimit, { enforce: false })
  const keyCount = await prisma.apiKey.count({
    where: { userId, enabled: true },
  })
  return { totalRemaining: q.remaining, keyCount }
}

/**
 * Records one successful API usage against the best key so a web UI generation can proceed after the web daily cap.
 */
export async function consumeOneApiQuotaForWebGeneration(userForLimit: {
  id: string
  plan: Plan
  customDailyLimit?: number | null
}): Promise<{ ok: true } | { ok: false; code: 'NO_KEYS' | 'NO_QUOTA' }> {
  const dailyLimit = getApiDailyLimit(userForLimit)
  const q = await checkDailyApiQuota(userForLimit.id, dailyLimit, { enforce: true })

  if (!q.allowed) return { ok: false, code: 'NO_QUOTA' }

  const firstKey = await prisma.apiKey.findFirst({
    where: { userId: userForLimit.id, enabled: true },
    select: { id: true },
  })
  if (!firstKey) return { ok: false, code: 'NO_KEYS' }

  await prisma.apiUsage.create({
    data: {
      apiKeyId: firstKey.id,
      endpoint: '/api/manifests/generate',
      method: 'POST',
      status: 200,
      ip: 'web-ui',
      userAgent: 'api-quota-trade-in',
    },
  })

  return { ok: true }
}

export function dailyQuotaHeaders(result: DailyQuotaResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Daily-Limit': String(result.limit),
    'X-Daily-Remaining': String(result.remaining),
    'X-Daily-Reset': String(result.resetAt),
  }
  if (result.errorReason) {
    headers['X-Daily-Error'] = result.errorReason
  }
  return headers
}

export async function getAppIdCount(userId: string): Promise<number> {
  const tenMinAgo = new Date(Date.now() - 600000)
  const uniqueAppIds = await prisma.apiUsage.groupBy({
    by: ['requestedAppId'],
    where: {
      apiKey: { userId },
      createdAt: { gte: tenMinAgo },
      requestedAppId: { not: null }
    }
  })
  return uniqueAppIds.length
}


export async function getActiveJails() {
  const now = new Date()
  const jails = await (prisma as any).rateLimitState.findMany({
    where: { blockedUntil: { gt: now } },
    select: { key: true, blockedUntil: true, violationCount: true }
  })

  return (jails as any[]).map(j => ({
    ip: j.key,
    blockedUntil: j.blockedUntil!.getTime(),
    violationCount: j.violationCount
  }))
}

export async function isIpBlacklisted(ip: string): Promise<boolean> {
  return BLACKLIST.has(ip)
}

export async function clearIpJail(ip: string) {
  await (prisma as any).rateLimitState.deleteMany({ where: { key: ip } })
}

/**
 * Bans a user by Discord ID and also blacklists their last IP and Fingerprint.
 */
export async function banUserGlobally(userId: string, reason: string = 'Administrative Ban', notify: boolean = true) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastIp: true, fingerprint: true, username: true, email: true, discordId: true }
  }) as any

  if (!user) return

  // 1. Mark user as banned in DB
  await prisma.user.update({
    where: { id: userId },
    data: { isBanned: true } as any
  })

  // 2. Disable all their API Keys
  await prisma.apiKey.updateMany({
    where: { userId },
    data: { enabled: false, adminDisable: true }
  })

  // 3. Notify the user
  if (notify) {
    const { sendWebBanEmail } = await import('./email');
    sendWebBanEmail(userId, reason).catch(err => console.error('[banUserGlobally notification error]', err));
  }

  // 4. Persist ban reason for the /banned page and appeals flow
  await prisma.sentinelLog.create({
    data: {
      userId,
      action: 'MANUAL_BAN',
      score: 100,
      reason,
      details: JSON.stringify({ source: 'banUserGlobally' }),
    },
  }).catch((err) => console.error('[banUserGlobally sentinel log error]', err));

  // 5. Blacklist their Last IP if present
  if (user.lastIp && user.lastIp !== 'unknown') {
    await (prisma as any).blacklistedIp.upsert({
      where: { ip: user.lastIp },
      update: { reason: `Associated with banned user: ${user.username}` },
      create: { ip: user.lastIp, reason: `Associated with banned user: ${user.username}` }
    })
    refreshBlacklist()
  }
}

/**
 * Unbans a user, re-enables their API keys, removes their last IP from blacklist, and refreshes cache.
 */
export async function unbanUserGlobally(userId: string, notify: boolean = true) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastIp: true, username: true, email: true, discordId: true }
  }) as any

  if (!user) return

  // 1. Mark user as unbanned in DB, reset jail and risk score
  await prisma.user.update({
    where: { id: userId },
    data: { isBanned: false, jailUntil: null, jailLevel: 0, riskScore: 0 } as any
  })

  // 2. Re-enable all their API Keys
  await prisma.apiKey.updateMany({
    where: { userId },
    data: { enabled: true, adminDisable: false }
  })

  // 3. Notify the user
  if (notify) {
    const { sendWebUnbanEmail } = await import('./email');
    sendWebUnbanEmail(userId).catch(err => console.error('[unbanUserGlobally notification error]', err));
  }

  // 3. Clear rate limit jails/states for the user's IP and API keys
  const userApiKeys = await prisma.apiKey.findMany({
    where: { userId },
    select: { key: true }
  })
  const apiKeyIds = userApiKeys.map(k => k.key)

  const keysToDelete: string[] = []
  if (user.lastIp && user.lastIp !== 'unknown') {
    keysToDelete.push(user.lastIp)
  }
  keysToDelete.push(...apiKeyIds)

  if (keysToDelete.length > 0) {
    await prisma.rateLimitState.deleteMany({
      where: { key: { in: keysToDelete } }
    })
  }

  // 4. Remove their IP from permanent blacklist
  if (user.lastIp && user.lastIp !== 'unknown') {
    await (prisma as any).blacklistedIp.deleteMany({
      where: { ip: user.lastIp }
    })
    await refreshBlacklist()
  }
}


export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  }
  if (result.errorReason) {
    headers['X-RateLimit-Error'] = result.errorReason
  }
  return headers
}
