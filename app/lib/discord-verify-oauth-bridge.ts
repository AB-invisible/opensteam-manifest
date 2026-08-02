import { cookies } from 'next/headers'
import { prisma } from '@/app/lib/prisma'
import { loadVerificationSession, writeVerificationAudit } from '@/app/lib/discord-verify-session'
import { VERIFY_OAUTH_SCOPES, getVerifyOAuthScopes } from '@/app/lib/discord-verify-scopes'
import { VerificationSessionStatus } from '@prisma/client'

export { VERIFY_OAUTH_SCOPES, getVerifyOAuthScopes }

export const VERIFY_S_COOKIE = 'gg_verify_s'
export const VERIFY_FLAG_COOKIE = 'gg_verify_oauth'
export const VERIFY_DONE_COOKIE = 'gg_verify_done'

const COOKIE_MAX_AGE = 30 * 60

function isSecureCookieEnv() {
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL || !!process.env.RAILWAY_STATIC_URL
}

export function setVerifyOAuthCookies(response: { cookies: { set: (name: string, value: string, options: object) => void } }, signed: string) {
  const secure = isSecureCookieEnv()
  const base = { httpOnly: true, sameSite: 'lax' as const, maxAge: COOKIE_MAX_AGE, path: '/' }
  response.cookies.set(VERIFY_FLAG_COOKIE, '1', { ...base, secure })
  response.cookies.set(VERIFY_S_COOKIE, signed, { ...base, secure })
}

export async function completeVerificationOAuthBridge(input: {
  discordId: string
  accessToken?: string | null
  refreshToken?: string | null
}): Promise<{ handled: boolean; error?: string }> {
  const cookieStore = cookies()
  if (cookieStore.get(VERIFY_FLAG_COOKIE)?.value !== '1') {
    return { handled: false }
  }

  const signed = cookieStore.get(VERIFY_S_COOKIE)?.value
  if (!signed) {
    return { handled: false, error: 'missing_session_cookie' }
  }

  const loaded = await loadVerificationSession(signed)
  if (!loaded.ok) {
    cookieStore.delete(VERIFY_FLAG_COOKIE)
    cookieStore.delete(VERIFY_S_COOKIE)
    return { handled: true, error: loaded.reason }
  }

  if (input.discordId !== loaded.session.discordId) {
    await prisma.discordVerificationSession.update({
      where: { id: loaded.session.id },
      data: { status: VerificationSessionStatus.FAILED },
    })
    await writeVerificationAudit({
      sessionId: loaded.session.id,
      discordId: loaded.session.discordId,
      action: 'OAUTH_ID_MISMATCH',
      details: { expected: loaded.session.discordId, received: input.discordId },
    })
    cookieStore.delete(VERIFY_FLAG_COOKIE)
    cookieStore.delete(VERIFY_S_COOKIE)
    return { handled: true, error: 'mismatch' }
  }

  await prisma.discordVerificationSession.update({
    where: { id: loaded.session.id },
    data: {
      status: VerificationSessionStatus.OAUTH_COMPLETE,
      oauthAccessToken: input.accessToken ?? undefined,
      oauthRefreshToken: input.refreshToken ?? loaded.session.oauthRefreshToken ?? undefined,
    },
  })

  await writeVerificationAudit({
    sessionId: loaded.session.id,
    discordId: input.discordId,
    action: 'OAUTH_COMPLETE',
  })

  cookieStore.delete(VERIFY_FLAG_COOKIE)
  cookieStore.delete(VERIFY_S_COOKIE)
  cookieStore.set(VERIFY_DONE_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 120,
    path: '/',
    secure: isSecureCookieEnv(),
  })

  return { handled: true }
}

export function isVerifyOAuthJustCompleted(): boolean {
  return cookies().get(VERIFY_DONE_COOKIE)?.value === '1'
}

export function clearVerifyDoneCookie() {
  cookies().delete(VERIFY_DONE_COOKIE)
}
