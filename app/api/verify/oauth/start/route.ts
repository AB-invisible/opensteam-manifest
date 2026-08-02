import { NextRequest, NextResponse } from 'next/server'
import { loadVerificationSession, writeVerificationAudit } from '@/app/lib/discord-verify-session'
import { setVerifyOAuthCookies } from '@/app/lib/discord-verify-oauth-bridge'
import { discordOAuthSignInRedirect } from '@/app/lib/discord-oauth-signin-redirect'
import { publicAppRedirect } from '@/app/lib/public-app-url'
import { VerificationSessionStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Starts verification OAuth via the existing NextAuth Discord callback
 * (/api/auth/callback/discord) — no second redirect URI required.
 */
export async function GET(request: NextRequest) {
  const s = request.nextUrl.searchParams.get('s')
  if (!s) {
    return NextResponse.redirect(publicAppRedirect(request, '/verify'))
  }

  const loaded = await loadVerificationSession(s)
  if (!loaded.ok) {
    return NextResponse.redirect(
      publicAppRedirect(request, `/verify?s=${encodeURIComponent(s)}&error=invalid`)
    )
  }

  if (loaded.session.status === VerificationSessionStatus.COMPLETED) {
    return NextResponse.redirect(
      publicAppRedirect(request, `/verify?s=${encodeURIComponent(s)}&success=1`)
    )
  }

  const callbackUrl = `/verify?s=${encodeURIComponent(s)}&step=confirm`

  await writeVerificationAudit({
    sessionId: loaded.session.id,
    discordId: loaded.session.discordId,
    action: 'OAUTH_STARTED',
  }).catch(() => {})

  const response = NextResponse.redirect(discordOAuthSignInRedirect(request, callbackUrl))
  setVerifyOAuthCookies(response, s)
  return response
}
