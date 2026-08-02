import { NextRequest, NextResponse } from 'next/server'
import { brandedOAuthResultHtml, completeBrandedLinkOAuth } from '@/app/lib/hosted-bot-oauth'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  if (oauthError) {
    return new NextResponse(
      brandedOAuthResultHtml({
        success: false,
        title: 'Authorization cancelled',
        message: 'Discord authorization was cancelled or denied. Run /link in your server to try again.',
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  if (!code || !state) {
    return new NextResponse(
      brandedOAuthResultHtml({
        success: false,
        title: 'Invalid callback',
        message: 'Missing authorization code. Run /link in your Discord server to start again.',
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  try {
    const result = await completeBrandedLinkOAuth(code, state)
    if (!result.ok) {
      return new NextResponse(
        brandedOAuthResultHtml({
          success: false,
          title: 'Link failed',
          message: result.error,
        }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    return new NextResponse(
      brandedOAuthResultHtml({
        success: true,
        title: 'Server linked',
        message: `Your Discord server is now linked to your OpenSteam subscription. /gen and /request are ready on that server.`,
        dashboardUrl: result.dashboardUrl,
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  } catch (e: any) {
    console.error('[Branded OAuth Callback]', e)
    return new NextResponse(
      brandedOAuthResultHtml({
        success: false,
        title: 'Link failed',
        message: e.message || 'An unexpected error occurred.',
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
