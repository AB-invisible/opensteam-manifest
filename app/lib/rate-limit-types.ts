export type RateLimitDenialCode =
  | 'BURST_LIMIT'
  | 'HOURLY_LIMIT'
  | 'DAILY_API_QUOTA'
  | 'WEB_DAILY_QUOTA'
  | 'API_QUOTA_EXHAUSTED'
  | 'NO_API_KEYS'
  | 'IP_JAIL'
  | 'ACCOUNT_SUSPENDED'
  | 'IP_BLACKLISTED'
  | 'SENTINEL_BLOCK'
  | 'ABUSE_AUTO_DISABLED'
  | 'UNKNOWN'

export type RateLimitScope = 'api' | 'web'

export interface RateLimitDenial {
  code: RateLimitDenialCode
  message: string
  reason: string
  retryAfter: number
  limit?: number
  remaining?: number
  resetAt?: number
  scope: RateLimitScope
}
