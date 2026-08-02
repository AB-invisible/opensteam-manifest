/** Client-safe rate limit helpers (no Node/server imports). */

export function formatRateLimitUserMessage(data: Record<string, unknown>): string {
  const message = String(data.message || data.reason || data.error || 'Rate limit exceeded.')
  const retryAfter = Number(data.retryAfter) || 0
  const resetAt = Number(data.resetAt) || 0

  if (retryAfter > 0) {
    if (retryAfter < 60) {
      return `${message} Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`
    }
    const minutes = Math.ceil(retryAfter / 60)
    if (minutes < 120) {
      return `${message} Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    const hours = Math.ceil(minutes / 60)
    return `${message} Try again in about ${hours} hour${hours === 1 ? '' : 's'}.`
  }

  if (resetAt > 0) {
    const resetLabel = new Date(resetAt * 1000).toLocaleString()
    return `${message} Resets at ${resetLabel}.`
  }

  return message
}

export function isRateLimitedResponse(status: number, data: Record<string, unknown>): boolean {
  return (
    status === 429 ||
    data.code === 'WEB_DAILY_QUOTA' ||
    data.code === 'WEB_QUOTA_EXHAUSTED' ||
    data.code === 'API_QUOTA_EXHAUSTED'
  )
}
