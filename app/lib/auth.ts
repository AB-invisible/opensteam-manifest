import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import {
  checkVelocityRateLimit,
  checkDailyApiQuota,
  rateLimitHeaders,
  dailyQuotaHeaders,
  RateLimitResult,
  DailyQuotaResult,
} from './ratelimit'
import { User, Plan } from '@prisma/client'
import { Sentinel, checkApiBurstAnomaly } from './sentinel'
import { getClientIp, getClientCountry } from './ip'
import { getApiDailyLimit, getApiBurstLimit, getApiHourlyLimit } from './config'
import { resolveAccessControlAllowOrigin } from './cors-origin'
import crypto from 'crypto'
import { resolveApiKeyFromRequest, safeKeyEquals } from './api-key-middleware'
import { internalServiceAuthHeaders } from './internal-service-auth'
import { verifyAdminApiKeyFromRequest } from './admin-api-key'
import {
  buildRateLimitDenial,
  denialFromLimits,
  rateLimitJsonBody,
  rateLimitResponseHeaders,
  type RateLimitDenial,
} from './rate-limit-denial'

export interface AuthResult {
  user: User
  /** Burst + hourly velocity (X-RateLimit-*). */
  rateLimit: RateLimitResult
  /** Per-UTC-day plan quota (X-Daily-*). */
  dailyQuota: DailyQuotaResult
  apiKeyId: string
  /** ID of the api_usage row created for this request (undefined when skipUsage). */
  usageLogId?: string
  /** Full API key record (from prisma). */
  apiKey: any 
}

export function isApiAccessAllowed(auth: AuthResult): boolean {
  return auth.rateLimit.allowed && auth.dailyQuota.allowed
}

/** Prefer daily quota message when both fail (parallel checks). */
export function apiAccessDenialMeta(auth: AuthResult): RateLimitDenial {
  return (
    denialFromLimits(auth.rateLimit, auth.dailyQuota) ||
    buildRateLimitDenial('UNKNOWN', 'Rate limit exceeded.', { scope: 'api' })
  )
}

export function apiRateLimitResponse(
  auth: AuthResult,
  requestOrigin?: string | null
): NextResponse {
  const denial = apiAccessDenialMeta(auth)
  return NextResponse.json(rateLimitJsonBody(denial), {
    status: 429,
    headers: rateLimitResponseHeaders(
      denial,
      apiHeaders(auth.rateLimit, auth.dailyQuota, requestOrigin)
    ),
  })
}

/**
 * Normalizes API endpoint paths to remove keys and appIds, allowing correct grouping in stats.
 */
export function normalizeEndpoint(pathname: string): string {
  let clean = pathname;
  // 1. Normalize legacy API keys in path (e.g. /api/gg_... or /api/mg_...)
  clean = clean.replace(/^\/api\/(gg_[0-9a-fA-F]+|mg_[0-9a-fA-F]+)/, '/api/[apiKey]');
  // 2. Normalize Steam App IDs (trailing numeric values)
  clean = clean.replace(/\/generate\/\d+$/, '/generate/[appId]');
  clean = clean.replace(/\/download\/\d+$/, '/download/[appId]');
  clean = clean.replace(/\/request\/\d+$/, '/request/[appId]');
  // 3. Normalize OnlineFix download names
  clean = clean.replace(/\/onlinefix\/download\/.+$/, '/onlinefix/download/[name]');
  return clean;
}

/**
 * Validates an API key (Bearer token or provided string) and returns user context.
 * Performs real-time Sentinel risk checking and plan limit determination.
 */
export async function authenticateApiKey(
  request: NextRequest, 
  _providedKeyOrOptions?: string | { skipUsage?: boolean; providedKey?: string }
): Promise<AuthResult | null> {
  const options = typeof _providedKeyOrOptions === 'string' 
    ? { providedKey: _providedKeyOrOptions } 
    : (_providedKeyOrOptions || {})

  const providedKey = options.providedKey ?? null
  const resolved = resolveApiKeyFromRequest(request, providedKey)

  if (!resolved.ok) {
    const ip = getClientIp(request)
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const url = request.nextUrl.pathname + request.nextUrl.search

    fetch(`${request.nextUrl.origin}/api/internal/security-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalServiceAuthHeaders(),
      },
      body: JSON.stringify({
        ip,
        path: url,
        userAgent,
        reason: resolved.code === 'BROWSER_AUTH_BLOCKED' || resolved.code === 'KEY_MISMATCH'
          ? 'API Key Hijack Attempt Blocked'
          : 'Unauthorized API Access Attempt',
        details: `${resolved.error} (${resolved.code})`,
      })
    }).catch(() => {})

    return null
  }

  const apiKey = resolved.key

  const keyRecord = await prisma.apiKey.findUnique({
    where: { key: apiKey },
    include: {
      user: true,
      organization: true
    }
  })

  if (!keyRecord || !keyRecord.enabled || keyRecord.user.isBanned || !safeKeyEquals(keyRecord.key, apiKey)) {
    const ip = getClientIp(request)
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const url = request.nextUrl.pathname + request.nextUrl.search

    fetch(`${request.nextUrl.origin}/api/internal/security-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalServiceAuthHeaders(),
      },
      body: JSON.stringify({ ip, path: url, userAgent, reason: 'Unauthorized API Access Attempt', details: 'Invalid or disabled API Key used.' })
    }).catch(() => {})

    return null
  }

  if ((keyRecord.user as any).discordGuildBannedAt) {
    return null
  }

  // Block users who have left the Discord server (non-admins/owners only)
  const memberStatus = (keyRecord.user as any).discordMemberStatus
  if (memberStatus === 'left' && !['ADMIN', 'OWNER'].includes(keyRecord.user.role)) {
    return null
  }

  // Determination of plan limits
  // If the key is linked to an organization, use the organization's plan for limits.
  // Otherwise, use the user's personal plan.
  let effectivePlan = (keyRecord.organization?.plan || keyRecord.user.plan) as Plan
  
  // Check for Plan Expiration
  if (keyRecord.user.planExpiry && new Date() > new Date(keyRecord.user.planExpiry)) {
    effectivePlan = 'FREE'
  }

  // Custom overrides always belong to the user record for now
  const dailyLimit = getApiDailyLimit({ ...keyRecord.user, plan: effectivePlan })
  const maxBurst = getApiBurstLimit({ ...keyRecord.user, plan: effectivePlan })
  const maxHourly = getApiHourlyLimit({ ...keyRecord.user, plan: effectivePlan })

  // Keep stored key hourly cap aligned with the user's current plan (legacy keys may still say 15).
  if (keyRecord.rateLimit < maxHourly) {
    prisma.apiKey
      .update({ where: { id: keyRecord.id }, data: { rateLimit: maxHourly } })
      .catch((e: any) => console.error('[Auth] Key rateLimit heal failed:', e.message))
  }

  // Get client info for logging
  const ip = getClientIp(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  // Extract AppID from URL if present (to detect scraper patterns)
  const appId = new URL(request.url).pathname.split('/').pop()?.match(/^\d+$/) ? new URL(request.url).pathname.split('/').pop() : undefined

  // 0. Check for IP Blacklist FIRST
  const isBlacklisted = await prisma.blacklistedIp.findUnique({ where: { ip } })
  if (isBlacklisted) {
    const realQuota = await checkDailyApiQuota(keyRecord.userId, dailyLimit, { enforce: false })
    return {
      user: keyRecord.user,
      apiKeyId: keyRecord.id,
      rateLimit: {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: Math.ceil((Date.now() + 3600000) / 1000),
        errorReason: 'Security Violation: Your network has been blacklisted for malicious activity.'
      },
      dailyQuota: realQuota,
      apiKey: keyRecord,
    }
  }

  // 1. Check with Sentinel for autonomous security (Risk/Jail)
  const sentinel = await Sentinel.checkRequest({
    userId: keyRecord.userId,
    ip,
    userAgent,
    payload: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    // Fingerprint might be passed in headers for API clients if they support it
    fingerprint: request.headers.get('X-Fingerprint') || (keyRecord.user as any).fingerprint
  })

  if (sentinel.blocked) {
    const realQuota = await checkDailyApiQuota(keyRecord.userId, dailyLimit, { enforce: false })
    return {
      user: keyRecord.user,
      apiKeyId: keyRecord.id,
      rateLimit: {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: Math.ceil((Date.now() + 3600000) / 1000),
        errorReason: sentinel.reason || 'Security Protocol: Request rejected by Sentinel.'
      },
      dailyQuota: realQuota,
      apiKey: keyRecord,
    }
  }

  // 2. Velocity (burst + hourly) and 3. Daily plan quota — independent checks.
  // Read-only routes (stats, activate, onlinefix catalog) skip velocity + usage logging.
  const [rateLimit, dailyQuota] = await Promise.all([
    options.skipUsage
      ? Promise.resolve({
          allowed: true,
          remaining: maxBurst,
          limit: maxBurst,
          resetAt: Math.ceil((Date.now() + 3600000) / 1000),
        } satisfies RateLimitResult)
      : checkVelocityRateLimit(
          keyRecord.userId,
          maxHourly,
          maxBurst,
          ip,
          appId || undefined,
          (keyRecord.user as any).securityBypass
        ),
    checkDailyApiQuota(keyRecord.userId, dailyLimit, { enforce: !options.skipUsage }),
  ])

  const allowed = isApiAccessAllowed({ user: keyRecord.user, rateLimit, dailyQuota, apiKeyId: keyRecord.id, apiKey: keyRecord })

  // Update last used & log usage (don't await — fire-and-forget for performance)
  if (rateLimit.isAutoDisabled) {
    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { enabled: false, lastUsed: new Date() }
    }).then(() => {
      // Trigger Discord Webhook for auto-disabling
      import('./webhooks').then(m => {
        m.sendWebhook('KEY_DISABLED', {
          keyName: keyRecord.name,
          keyId: keyRecord.id,
          ip,
          reason: rateLimit.errorReason || 'Repeated abuse score threshold reached.'
        })
      })
    }).catch((e: any) => console.error('[Auth] Key auto-disable failed:', e.message))
  } else if (allowed) {
    void checkApiBurstAnomaly({
      userId: keyRecord.userId,
      apiKeyId: keyRecord.id,
      ip,
      burstLimit: maxBurst,
    })

    // Update last used & user IP/UA if changed
    const updates: any = { lastUsed: new Date() }
    const userUpdates: any = {}
    
    if (keyRecord.user.lastIp !== ip) userUpdates.lastIp = ip
    if (keyRecord.user.lastUserAgent !== userAgent) userUpdates.lastUserAgent = userAgent

    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: updates
    }).catch((e: any) => console.error('[Auth] Key lastUsed update failed:', e.message))

    if (Object.keys(userUpdates).length > 0) {
      prisma.user.update({
        where: { id: keyRecord.userId },
        data: userUpdates
      }).catch((e: any) => console.error('[Auth] User IP/UA update failed:', e.message))
    }
  }

  // Trigger alert for detected scraper pattern (even if not disabled yet)
  if (rateLimit.isScraperDetected) {
    import('./ratelimit').then(async rlm => {
      const count = await rlm.getAppIdCount(keyRecord.userId)
      import('./webhooks').then(m => {
        m.sendWebhook('ABUSE_ALERT', {
          ip,
          keyName: keyRecord.name,
          reason: 'High AppID Variance (Potential Scraper)',
          details: `Key hit ${count} unique AppIDs in a short window.`
        })
      })
    })
  }

  // Only log detailed persistent usage/logs if NOT skipping usage tracking
  let usageLogId: string | undefined
  if (!options.skipUsage) {
    try {
      const log = await prisma.apiUsage.create({
        data: {
          apiKeyId: keyRecord.id,
          endpoint: normalizeEndpoint(new URL(request.url).pathname),
          method: request.method,
          status: allowed ? 200 : 429,
          ip,
          userAgent,
          userCountry: getClientCountry(request),
          fingerprint: request.headers.get('X-Fingerprint') || (keyRecord.user as any).fingerprint,
          requestedAppId: appId || null
        } as any
      })
      usageLogId = log.id
    } catch (e: any) {
      console.error('[Auth] Usage log failed:', e.message)
    }
  }

  return {
    user: keyRecord.user,
    apiKeyId: keyRecord.id,
    rateLimit,
    dailyQuota,
    usageLogId,
    apiKey: keyRecord,
  }
}

const ADMIN_SERVICE_RATE: RateLimitResult = {
  allowed: true,
  remaining: 999999,
  limit: 999999,
  resetAt: Math.ceil((Date.now() + 3600000) / 1000),
}

const ADMIN_SERVICE_QUOTA: DailyQuotaResult = {
  allowed: true,
  remaining: 999999,
  limit: 999999,
  resetAt: Math.ceil(new Date().setUTCHours(24, 0, 0, 0) / 1000),
}

async function resolveAdminServiceUser(): Promise<User | null> {
  const operatorDiscordId = process.env.UPLOAD_OPERATOR_DISCORD_ID?.trim()
  return (
    (operatorDiscordId
      ? await prisma.user.findUnique({ where: { discordId: operatorDiscordId } })
      : null) ||
    (await prisma.user.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    })) ||
    (await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    }))
  )
}

/** Bot/cron callers using ADMIN_API_KEY (Bearer or X-API-Key), then normal user API keys. */
export async function authenticateApiKeyOrAdmin(
  request: NextRequest,
  options?: { skipUsage?: boolean; providedKey?: string }
): Promise<AuthResult | null> {
  if (verifyAdminApiKeyFromRequest(request)) {
    const user = await resolveAdminServiceUser()
    if (user) {
      return {
        user,
        rateLimit: ADMIN_SERVICE_RATE,
        dailyQuota: ADMIN_SERVICE_QUOTA,
        apiKeyId: 'admin-service',
        apiKey: null,
      }
    }
    console.error('[Auth] Valid ADMIN_API_KEY but no service user (OWNER/ADMIN) found.')
    return null
  }

  return authenticateApiKey(request, options)
}

/**
 * CORS headers for API responses.
 * Pass `Origin` from the incoming request when available so ACAO matches middleware behavior.
 */
export function corsHeaders(requestOrigin?: string | null): Record<string, string> {
  const acao = resolveAccessControlAllowOrigin(requestOrigin ?? undefined)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Fingerprint',
    'Access-Control-Expose-Headers': [
      'Content-Disposition',
      'Content-Length',
      'X-Daily-Error',
      'X-Daily-Limit',
      'X-Daily-Remaining',
      'X-Daily-Reset',
      'X-RateLimit-Code',
      'X-RateLimit-Error',
      'X-RateLimit-Limit',
      'X-RateLimit-Reason',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-VPN-Blocked',
    ].join(', '),
    'Access-Control-Max-Age': '86400',
  }
  if (acao !== null) {
    headers['Access-Control-Allow-Origin'] = acao
  }
  return headers
}

/**
 * API Key Security Logic
 */
export async function rotateApiKey(keyId: string, ip?: string): Promise<string> {
  const newKey = `gg_${crypto.randomBytes(32).toString('hex')}`
  
  await prisma.$transaction(async (tx) => {
    const oldKey = await tx.apiKey.findUnique({ where: { id: keyId } })
    if (!oldKey) throw new Error('Key not found')

    await tx.apiKey.update({
      where: { id: keyId },
      data: {
        key: newKey,
        lastRotatedAt: new Date(),
        updatedAt: new Date()
      }
    })

    // Log the rotation in audits
    await tx.keyAudit.create({
      data: {
        apiKeyId: keyId,
        action: 'ROTATED',
        ip: ip,
        details: { oldKeyMasked: oldKey.key.substring(0, 8) + '...' }
      }
    })
  })

  return newKey
}

export async function auditApiKey(keyId: string, action: string, details: any, ip?: string) {
  try {
    await prisma.keyAudit.create({
      data: {
        apiKeyId: keyId,
        action,
        details,
        ip
      }
    })
  } catch (e) {
    console.error('[Key Audit Error]', e)
  }
}

/**
 * CORS + velocity (X-RateLimit-*) + daily quota (X-Daily-*).
 */
export function apiHeaders(
  rateLimit?: RateLimitResult,
  dailyQuota?: DailyQuotaResult,
  requestOrigin?: string | null
): Record<string, string> {
  return {
    ...corsHeaders(requestOrigin),
    ...(rateLimit ? rateLimitHeaders(rateLimit) : {}),
    ...(dailyQuota ? dailyQuotaHeaders(dailyQuota) : {}),
  }
}

/**
 * Returns a custom 666 status code response for deprecated legacy endpoints.
 * Next.js strictly validates Response status to be 200-599. We use a workaround
 * to return 666 without crashing the server with a RangeError (which causes 500).
 */
export function legacyCutoffResponse(
  rateLimit?: RateLimitResult,
  dailyQuota?: DailyQuotaResult,
  requestOrigin?: string | null
): NextResponse {
  const res = NextResponse.json(
    { error: 'Please use our new v2 endpoint from http://127.0.0.1:3000/docs' },
    { status: 400, headers: apiHeaders(rateLimit, dailyQuota, requestOrigin) }
  )
  // Attempt to bypass Next.js RangeError validation by overriding the getter
  Object.defineProperty(res, 'status', { get: () => 666 })
  return res
}
