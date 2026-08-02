import { NextResponse } from 'next/server'
import type { DailyQuotaResult, RateLimitResult } from './ratelimit'
import { dailyQuotaHeaders, rateLimitHeaders } from './ratelimit'
import type { RateLimitDenial, RateLimitDenialCode, RateLimitScope } from './rate-limit-types'

export type { RateLimitDenial, RateLimitDenialCode, RateLimitScope } from './rate-limit-types'

function retryAfterFromReset(resetAt?: number): number {
  if (!resetAt) return 0
  return Math.max(0, resetAt - Math.floor(Date.now() / 1000))
}

function classifyVelocityDenial(result: RateLimitResult): RateLimitDenial {
  const reason = result.errorReason || 'Rate limit exceeded.'
  const retryAfter = retryAfterFromReset(result.resetAt)
  let code: RateLimitDenialCode = 'UNKNOWN'

  if (result.isAutoDisabled) {
    code = 'ABUSE_AUTO_DISABLED'
  } else if (/blacklisted/i.test(reason)) {
    code = 'IP_BLACKLISTED'
  } else if (/IP Jail/i.test(reason)) {
    code = 'IP_JAIL'
  } else if (/suspended|Abuse detected/i.test(reason)) {
    code = 'ACCOUNT_SUSPENDED'
  } else if (/Sentinel|Security Protocol/i.test(reason)) {
    code = 'SENTINEL_BLOCK'
  } else if (/burst|slow down/i.test(reason)) {
    code = 'BURST_LIMIT'
  } else if (/Hourly rate limit/i.test(reason)) {
    code = 'HOURLY_LIMIT'
  }

  return {
    code,
    message: reason,
    reason,
    retryAfter,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
    scope: 'api',
  }
}

function classifyDailyQuotaDenial(result: DailyQuotaResult): RateLimitDenial {
  const reason = result.errorReason || 'Daily API quota exceeded for your account.'
  return {
    code: 'DAILY_API_QUOTA',
    message: reason,
    reason,
    retryAfter: retryAfterFromReset(result.resetAt),
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
    scope: 'api',
  }
}

export function denialFromLimits(
  rateLimit: RateLimitResult,
  dailyQuota: DailyQuotaResult
): RateLimitDenial | null {
  if (rateLimit.allowed && dailyQuota.allowed) return null
  if (!dailyQuota.allowed) return classifyDailyQuotaDenial(dailyQuota)
  if (!rateLimit.allowed) return classifyVelocityDenial(rateLimit)
  return null
}

export function buildRateLimitDenial(
  code: RateLimitDenialCode,
  message: string,
  opts?: {
    retryAfter?: number
    resetAt?: number
    limit?: number
    remaining?: number
    scope?: RateLimitScope
  }
): RateLimitDenial {
  const resetAt = opts?.resetAt
  return {
    code,
    message,
    reason: message,
    retryAfter: opts?.retryAfter ?? retryAfterFromReset(resetAt),
    resetAt,
    limit: opts?.limit,
    remaining: opts?.remaining,
    scope: opts?.scope || 'web',
  }
}

export function rateLimitJsonBody(
  denial: RateLimitDenial,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    error: 'Rate limit exceeded',
    code: denial.code,
    message: denial.message,
    reason: denial.reason,
    retryAfter: denial.retryAfter,
    resetAt: denial.resetAt,
    limit: denial.limit,
    remaining: denial.remaining,
    scope: denial.scope,
    ...extra,
  }
}

export function rateLimitResponseHeaders(
  denial: RateLimitDenial,
  baseHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers = { ...baseHeaders }
  if (denial.retryAfter > 0) {
    headers['Retry-After'] = String(denial.retryAfter)
  }
  headers['X-RateLimit-Reason'] = denial.reason
  headers['X-RateLimit-Code'] = denial.code
  return headers
}

export function mergeQuotaHeaders(
  velocity?: RateLimitResult,
  daily?: DailyQuotaResult,
  web?: { limit: number; remaining: number; resetAt: number }
): Record<string, string> {
  return {
    ...(velocity ? rateLimitHeaders(velocity) : {}),
    ...(daily ? dailyQuotaHeaders(daily) : {}),
    ...(web
      ? {
          'X-Web-Daily-Limit': String(web.limit),
          'X-Web-Daily-Remaining': String(web.remaining),
          'X-Web-Daily-Reset': String(web.resetAt),
        }
      : {}),
  }
}

export function webRateLimitResponse(
  denial: RateLimitDenial,
  extra?: Record<string, unknown>,
  baseHeaders: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(rateLimitJsonBody(denial, extra), {
    status: 429,
    headers: rateLimitResponseHeaders(denial, baseHeaders),
  })
}
