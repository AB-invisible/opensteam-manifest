import { NextRequest, NextResponse } from 'next/server'
import NextAuth, { type NextAuthOptions } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import DiscordProvider from 'next-auth/providers/discord'
import { logAuthIssue } from '@/app/lib/auth-issue-log'
import { VERIFY_FLAG_COOKIE, VERIFY_S_COOKIE, getVerifyOAuthScopes } from '@/app/lib/discord-verify-oauth-bridge'
import { getClientIp } from '@/app/lib/ip'
import { setResponseCookie } from '@/app/lib/response-cookies'
import {
  resolveActiveOAuthCredentials,
  resolveOAuthCredentialsBySource,
  resolvePrimaryOAuthCredentials,
  type BotTokenSource,
} from '@/app/lib/discord-bot-credentials'
import {
  clearOAuthSourceCookie,
  parseOAuthSourceCookie,
  setOAuthSourceCookie,
} from '@/app/lib/discord-oauth-flow-bridge'

type AuthRouteContext = { params: Promise<{ nextauth?: string[] }> }

type ResolvedOAuth = {
  clientId: string
  clientSecret: string
  oauthSource: BotTokenSource
  isVerifyOAuth: boolean
}

function parseCookieHeader(header?: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    const value = trimmed.slice(eq + 1)
    out[key] = decodeURIComponent(value)
  }
  return out
}

function oauthActionNeedsProviderSetup(action: string | undefined): boolean {
  return action === 'signin' || action === 'callback' || action === 'providers'
}

function buildDiscordProvider(clientId: string, clientSecret: string, isVerifyOAuth: boolean) {
  const scope = isVerifyOAuth ? getVerifyOAuthScopes() : 'identify email guilds.join'

  return DiscordProvider({
    clientId,
    clientSecret,
    authorization: {
      params: {
        scope,
        ...(isVerifyOAuth ? { prompt: 'consent' } : {}),
      },
    },
    async profile(profile) {
      const avatarHash = profile.avatar
      const ext = avatarHash?.startsWith('a_') ? 'gif' : 'png'
      const oauthImageUrl = avatarHash
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${avatarHash}.${ext}`
        : null
      return {
        id: profile.id,
        name: profile.username,
        email: profile.email,
        image: oauthImageUrl,
      }
    },
  })
}

function clearOAuthFlowCookies(response: Response) {
  const secure = process.env.NODE_ENV === 'production' || !!process.env.VERCEL || !!process.env.RAILWAY_STATIC_URL
  const base = { httpOnly: true, sameSite: 'lax' as const, maxAge: 0, path: '/' }
  setResponseCookie(response, VERIFY_FLAG_COOKIE, '', { ...base, secure })
  setResponseCookie(response, VERIFY_S_COOKIE, '', { ...base, secure })
  clearOAuthSourceCookie(response)
}

function oauthCallbackHasError(req: NextRequest): boolean {
  return req.nextUrl.searchParams.has('error')
}

async function resolveOAuthForAction(
  req: NextRequest,
  action: string | undefined
): Promise<ResolvedOAuth> {
  const cookies = parseCookieHeader(req.headers.get('cookie'))
  const isVerifyOAuth =
    cookies[VERIFY_FLAG_COOKIE] === '1' && Boolean(cookies[VERIFY_S_COOKIE]?.trim())

  let clientId = ''
  let clientSecret = ''
  let oauthSource: BotTokenSource = 'primary'

  const pinnedSource = action === 'callback' ? parseOAuthSourceCookie(cookies) : null

  try {
    const active = isVerifyOAuth
      ? pinnedSource
        ? await resolveOAuthCredentialsBySource(pinnedSource)
        : await resolveActiveOAuthCredentials()
      : pinnedSource
        ? await resolveOAuthCredentialsBySource(pinnedSource)
        : await resolvePrimaryOAuthCredentials()
    clientId = active.clientId || ''
    clientSecret = active.clientSecret || ''
    oauthSource = pinnedSource ?? active.source
  } catch (err) {
    console.error('[NextAuth] Failed to load Discord OAuth credentials:', err)
  }

  if (!clientId || !clientSecret) {
    clientId = process.env.DISCORD_CLIENT_ID || ''
    clientSecret = process.env.DISCORD_CLIENT_SECRET || ''
    oauthSource = 'primary'
  }

  if (!clientId || !clientSecret) {
    console.error('[NextAuth] Missing Discord OAuth credentials (primary or backup, env or admin settings)')
    logAuthIssue({
      stage: 'nextauth:missing_credentials',
      error: 'Discord OAuth client ID or secret not configured',
      flow: isVerifyOAuth ? 'verify' : 'login',
      ip: getClientIp(req),
      details: { oauthSource, pinnedSource },
    })
  } else if (oauthSource === 'backup') {
    console.info(
      '[NextAuth] Using backup Discord OAuth app for',
      isVerifyOAuth ? 'verify' : 'login',
      pinnedSource ? '(pinned)' : ''
    )
  }

  return { clientId, clientSecret, oauthSource, isVerifyOAuth }
}

async function resolveAuthOptions(
  req: NextRequest,
  action: string | undefined
): Promise<{ options: NextAuthOptions; oauth: ResolvedOAuth }> {
  if (!oauthActionNeedsProviderSetup(action)) {
    return {
      options: authOptions,
      oauth: { clientId: '', clientSecret: '', oauthSource: 'primary', isVerifyOAuth: false },
    }
  }

  const oauth = await resolveOAuthForAction(req, action)

  return {
    oauth,
    options: {
      ...authOptions,
      providers: [
        buildDiscordProvider(
          oauth.clientId || 'PENDING',
          oauth.clientSecret || 'PENDING',
          oauth.isVerifyOAuth
        ),
      ],
    },
  }
}

async function handler(req: NextRequest, context: AuthRouteContext) {
  try {
    const params = await context.params
    const action = params?.nextauth?.[0]

    if (action === 'callback' && oauthCallbackHasError(req)) {
      const error = req.nextUrl.searchParams.get('error')
      const errorDescription = req.nextUrl.searchParams.get('error_description')
      logAuthIssue({
        stage: 'nextauth:oauth_callback_error',
        error: error || 'oauth_callback_error',
        flow: 'unknown',
        ip: getClientIp(req),
        details: { error, errorDescription },
      })

      const response = NextResponse.redirect(
        new URL(
          `/auth/signin?error=${encodeURIComponent(error || 'OAuthCallback')}`,
          req.url
        )
      )
      clearOAuthFlowCookies(response)
      return response
    }

    const { options, oauth } = await resolveAuthOptions(req, action)
    const nextAuthHandler = NextAuth(options)
    const response = await nextAuthHandler(req, context)

    if (action === 'signin' && oauth.clientId && oauth.clientSecret) {
      setOAuthSourceCookie(response, oauth.oauthSource)
    }

    if (action === 'callback') {
      clearOAuthSourceCookie(response)
      if (oauth.isVerifyOAuth) {
        const secure =
          process.env.NODE_ENV === 'production' ||
          !!process.env.VERCEL ||
          !!process.env.RAILWAY_STATIC_URL
        const base = { httpOnly: true, sameSite: 'lax' as const, maxAge: 0, path: '/' }
        setResponseCookie(response, VERIFY_FLAG_COOKIE, '', { ...base, secure })
        setResponseCookie(response, VERIFY_S_COOKIE, '', { ...base, secure })
      }
    }

    return response
  } catch (error) {
    console.error('[NextAuth] Route handler error:', error)
    logAuthIssue({
      stage: 'nextauth:handler_exception',
      error: error instanceof Error ? error.message : 'Unknown auth handler error',
      flow: 'unknown',
      ip: getClientIp(req),
    })
    return NextResponse.json({ error: 'AuthUnavailable' }, { status: 503 })
  }
}

export { handler as GET, handler as POST }
