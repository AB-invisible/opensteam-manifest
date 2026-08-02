import { describe, it, expect } from 'vitest'
import {
  buildRateLimitDenial,
  denialFromLimits,
  rateLimitJsonBody,
} from '@/app/lib/rate-limit-denial'
import { formatRateLimitUserMessage } from '@/app/lib/rate-limit-client'

describe('denialFromLimits', () => {
  const allowedVelocity = { allowed: true, remaining: 10, limit: 100, resetAt: 9999999999 }
  const allowedDaily = { allowed: true, remaining: 50, limit: 100, resetAt: 9999999999 }

  it('classifies burst denials', () => {
    const denial = denialFromLimits(
      {
        allowed: false,
        remaining: 0,
        limit: 100,
        resetAt: Math.floor(Date.now() / 1000) + 30,
        errorReason: 'Rate limit burst detection: Please slow down. (Score: 3/15)',
      },
      allowedDaily
    )
    expect(denial?.code).toBe('BURST_LIMIT')
    expect(denial?.message).toContain('burst')
  })

  it('classifies daily API quota denials', () => {
    const denial = denialFromLimits(allowedVelocity, {
      allowed: false,
      remaining: 0,
      limit: 50,
      resetAt: Math.floor(Date.now() / 1000) + 3600,
      errorReason: 'Daily limit of 50 requests exceeded for your account.',
    })
    expect(denial?.code).toBe('DAILY_API_QUOTA')
  })

  it('prefers daily quota over velocity when both fail', () => {
    const denial = denialFromLimits(
      {
        allowed: false,
        remaining: 0,
        limit: 100,
        resetAt: Math.floor(Date.now() / 1000) + 30,
        errorReason: 'Rate limit burst detection',
      },
      {
        allowed: false,
        remaining: 0,
        limit: 50,
        resetAt: Math.floor(Date.now() / 1000) + 3600,
        errorReason: 'Daily limit exceeded.',
      }
    )
    expect(denial?.code).toBe('DAILY_API_QUOTA')
  })
})

describe('rateLimitJsonBody', () => {
  it('returns unified 429 payload fields', () => {
    const body = rateLimitJsonBody(
      buildRateLimitDenial('HOURLY_LIMIT', 'Hourly rate limit exceeded.', {
        retryAfter: 120,
        scope: 'api',
      })
    )
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.code).toBe('HOURLY_LIMIT')
    expect(body.reason).toBe('Hourly rate limit exceeded.')
    expect(body.retryAfter).toBe(120)
  })
})

describe('formatRateLimitUserMessage', () => {
  it('appends retry guidance when retryAfter is set', () => {
    const msg = formatRateLimitUserMessage({
      message: 'Hourly rate limit exceeded.',
      retryAfter: 90,
    })
    expect(msg).toContain('Hourly rate limit exceeded.')
    expect(msg).toContain('minute')
  })
})
