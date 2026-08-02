import type { BotTokenSource } from '@/app/lib/discord-bot-credentials'
import { setResponseCookie, type ResponseCookieTarget } from '@/app/lib/response-cookies'

export const OAUTH_SOURCE_COOKIE = 'gg_oauth_src'

const COOKIE_MAX_AGE = 30 * 60

function isSecureCookieEnv() {
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL || !!process.env.RAILWAY_STATIC_URL
}

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isSecureCookieEnv(),
  }
}

export function parseOAuthSourceCookie(
  cookies: Record<string, string>
): BotTokenSource | null {
  const value = cookies[OAUTH_SOURCE_COOKIE]?.trim()
  if (value === 'primary' || value === 'backup') return value
  return null
}

export function setOAuthSourceCookie(
  response: ResponseCookieTarget,
  source: BotTokenSource
) {
  setResponseCookie(response, OAUTH_SOURCE_COOKIE, source, {
    ...baseCookieOptions(),
    maxAge: COOKIE_MAX_AGE,
  })
}

export function clearOAuthSourceCookie(
  response: ResponseCookieTarget
) {
  setResponseCookie(response, OAUTH_SOURCE_COOKIE, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  })
}
