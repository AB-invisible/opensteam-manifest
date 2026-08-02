import { describe, it, expect } from 'vitest'
import { corsHeaders, isApiAccessAllowed } from '@/app/lib/auth'

describe('isApiAccessAllowed', () => {
  const baseAuth = {
    user: {} as any,
    apiKeyId: 'k1',
    apiKey: {},
    rateLimit: { allowed: true, remaining: 10, limit: 100, resetAt: 0 },
    dailyQuota: { allowed: true, remaining: 50, limit: 100, resetAt: 0 },
  }

  it('allows when burst and daily quota are available', () => {
    expect(isApiAccessAllowed(baseAuth)).toBe(true)
  })

  it('blocks when daily quota is exhausted', () => {
    expect(
      isApiAccessAllowed({
        ...baseAuth,
        dailyQuota: { ...baseAuth.dailyQuota, allowed: false },
      })
    ).toBe(false)
  })

  it('blocks when burst rate limit is exceeded', () => {
    expect(
      isApiAccessAllowed({
        ...baseAuth,
        rateLimit: { ...baseAuth.rateLimit, allowed: false },
      })
    ).toBe(false)
  })
})

describe('corsHeaders', () => {
  it('allows v2 API auth/fingerprint headers and exposes API metadata headers', () => {
    const headers = corsHeaders('http://127.0.0.1:3000')

    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(headers['Access-Control-Allow-Headers']).toContain('X-API-Key')
    expect(headers['Access-Control-Allow-Headers']).toContain('X-Fingerprint')
    expect(headers['Access-Control-Expose-Headers']).toContain('X-RateLimit-Remaining')
    expect(headers['Access-Control-Expose-Headers']).toContain('X-Daily-Remaining')
    expect(headers['Access-Control-Expose-Headers']).toContain('Content-Disposition')
  })
})
