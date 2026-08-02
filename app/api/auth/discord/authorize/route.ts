import { NextRequest, NextResponse } from 'next/server'
import { discordOAuthSignInRedirect } from '@/app/lib/discord-oauth-signin-redirect'

export const dynamic = 'force-dynamic'

/** Legacy GET entry — browser must POST to NextAuth; redirect to client sign-in kickoff. */
export async function GET(request: NextRequest) {
  const callbackUrl =
    request.nextUrl.searchParams.get('callbackUrl')?.trim() || '/'
  return NextResponse.redirect(discordOAuthSignInRedirect(request, callbackUrl))
}
