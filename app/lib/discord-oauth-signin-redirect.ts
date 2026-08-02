import type { NextRequest } from 'next/server'
import { publicAppRedirect } from './public-app-url'

/** Redirect to the branded sign-in page and auto-start Discord OAuth in the browser. */
export function discordOAuthSignInRedirect(
  request: NextRequest,
  callbackUrl: string
): URL {
  const target = publicAppRedirect(request, '/auth/signin')
  target.searchParams.set('callbackUrl', callbackUrl)
  target.searchParams.set('autostart', '1')
  return target
}
