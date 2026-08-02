import { NextRequest, NextResponse, NextFetchEvent } from 'next/server'
import { isMalicious, isScraperUserAgent } from './app/lib/security-patterns'
import { resolveAccessControlAllowOrigin } from './app/lib/cors-origin'
import { pingHeartbeat } from './app/lib/heartbeat'
import { logToBetterStack } from './app/lib/otel-edge'
import { isVpnOrProxy } from './app/lib/vpn-proxy-check'
import { getClientIp, getSecurityContextFromRequest, securityContextToLogPayload } from './app/lib/ip'
import { shouldBypassVpnForApiKeyRequest } from './app/lib/api-key-edge'
import { verifyAdminApiKeyFromRequest, verifyUptimeMonitorFromRequest } from './app/lib/admin-api-key'
import { internalServiceAuthHeaders } from './app/lib/internal-service-headers'
import { isBotApiRoute } from './app/lib/api-key-middleware'
import { isLocalOpenSteamHost, isLocalhostHost, isTunnelHost } from './app/lib/app-hosts'

function applyApiCors(response: NextResponse, request: NextRequest, includeMaxAge: boolean) {
  const origin = resolveAccessControlAllowOrigin(request.headers.get('Origin'))
  if (origin !== null) {
    response.headers.set('Access-Control-Allow-Origin', origin)
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Fingerprint')
  response.headers.set(
    'Access-Control-Expose-Headers',
    [
      'Content-Disposition',
      'Content-Length',
      'X-Daily-Error',
      'X-Daily-Limit',
      'X-Daily-Remaining',
      'X-Daily-Reset',
      'X-RateLimit-Code',
      'X-RateLimit-Error',
      'X-RateLimit-Limit',
      'X-RateLimit-Reason',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-VPN-Blocked',
    ].join(', ')
  )
  if (includeMaxAge) {
    response.headers.set('Access-Control-Max-Age', '86400')
  }
}

/**
 * Next.js Middleware — runs on every request.
 */
export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const isHighFrequencyAuthRoute = request.nextUrl.pathname.startsWith('/api/auth')

  // Skip per-poll logging/heartbeat on NextAuth session routes.
  if (!isHighFrequencyAuthRoute) {
    pingHeartbeat('api');
    logToBetterStack(`API Request: ${request.method} ${request.nextUrl.pathname}`, 'INFO', {
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent') || 'unknown'
    });
  }

  // 1. Admin Bypass & Malicious Pattern Check
  const isAdmin = verifyAdminApiKeyFromRequest(request)

  const url = request.nextUrl.pathname + request.nextUrl.search
  const maliciousMatch = isMalicious(url) || isMalicious(request.headers.get('referer') || '')
  if (!isAdmin && maliciousMatch) {
    const ip = getClientIp(request)
    const userAgent = request.headers.get('user-agent') || 'unknown'
    
    // Fire-and-forget webhook
    event.waitUntil(
      fetch(`${request.nextUrl.origin}/api/internal/security-log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...internalServiceAuthHeaders(),
        },
        body: JSON.stringify({
          ...securityContextToLogPayload(getSecurityContextFromRequest(request, { path: url })),
          path: url,
          userAgent,
          reason: 'Malicious Pattern Detected',
          details: `Middleware intercepted illegal pattern: ${maliciousMatch}`
        })
      }).catch(() => {})
    )

    return new NextResponse(
      JSON.stringify({
        error: 'Security Violation: Request contains illegal query commands or patterns.',
        code: 'SEC_VIOLATION',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 1.5 Scraper Check
  const hasValidApiKey = shouldBypassVpnForApiKeyRequest(request)
  const isApiRouteForBots = isBotApiRoute(request.nextUrl.pathname)
  const isExemptFromScraperCheck = isAdmin || hasValidApiKey || verifyUptimeMonitorFromRequest(request) || isApiRouteForBots
  
  if (!isExemptFromScraperCheck) {
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const scraperMatch = isScraperUserAgent(userAgent)
    
    if (scraperMatch) {
      const uaLower = userAgent.toLowerCase()
      const isAllowedBot = 
        uaLower.includes('telegrambot') ||
        uaLower.includes('twitterbot') ||
        uaLower.includes('facebookexternalhit') ||
        uaLower.includes('linkedinbot') ||
        uaLower.includes('discordbot') ||
        uaLower.includes('slackbot') ||
        uaLower.includes('whatsapp') ||
        uaLower.includes('google') ||
        uaLower.includes('bingbot') ||
        uaLower.includes('yandex') ||
        uaLower.includes('applebot')

      if (!isAllowedBot) {
        event.waitUntil(
          fetch(`${request.nextUrl.origin}/api/internal/security-log`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...internalServiceAuthHeaders(),
            },
            body: JSON.stringify({
              ...securityContextToLogPayload(getSecurityContextFromRequest(request, { path: url })),
              path: url,
              userAgent,
              reason: 'Scraper Detected',
              details: `Middleware intercepted scraper: ${scraperMatch}`
            })
          }).catch(() => {})
        )

        return new NextResponse(
          JSON.stringify({
            error: 'Forbidden: Automated scraping tools are not permitted without an API key.',
            code: 'SEC_SCRAPER_DETECTED',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }
  }

  // NextAuth error/sign-in API pages → branded UI (preserve query params).
  if (request.nextUrl.pathname === '/api/auth/signin') {
    const target = new URL('/auth/signin', request.url)
    request.nextUrl.searchParams.forEach((value, key) => {
      target.searchParams.set(key, value)
    })
    return NextResponse.redirect(target)
  }

  // GET /api/auth/signin/discord does not start OAuth — use client signIn() via /auth/signin.
  if (
    request.method === 'GET' &&
    request.nextUrl.pathname === '/api/auth/signin/discord'
  ) {
    const target = new URL('/auth/signin', request.url)
    request.nextUrl.searchParams.forEach((value, key) => {
      target.searchParams.set(key, value)
    })
    target.searchParams.set('autostart', '1')
    return NextResponse.redirect(target)
  }

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()

  // Secure session cookies only work over HTTPS — redirect HTTP visitors when the site URL is HTTPS.
  if (publicAppUrl?.startsWith('https://')) {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    const requestHost = (
      request.headers.get('x-forwarded-host') ||
      request.headers.get('host') ||
      ''
    )
      .split(',')[0]
      .trim()
      .toLowerCase()
    const isHttps =
      forwardedProto === 'https' ||
      request.nextUrl.protocol === 'https:'
    if (
      !isHttps &&
      !request.nextUrl.pathname.startsWith('/api/') &&
      !isLocalhostHost(requestHost)
    ) {
      const target = new URL(request.url)
      try {
        const canonical = new URL(publicAppUrl)
        target.protocol = 'https:'
        target.host = canonical.host
      } catch {
        target.protocol = 'https:'
      }
      return NextResponse.redirect(target, 308)
    }
  }

  // Keep OAuth cookies on one canonical host (www vs apex). Allow tunnel + local domains.
  if (publicAppUrl) {
    try {
      const canonicalHost = new URL(publicAppUrl).host.toLowerCase()
      const requestHost = (
        request.headers.get('x-forwarded-host') ||
        request.headers.get('host') ||
        ''
      )
        .split(',')[0]
        .trim()
        .toLowerCase()
      if (
        requestHost &&
        requestHost !== canonicalHost &&
        !isTunnelHost(requestHost) &&
        !isLocalOpenSteamHost(requestHost)
      ) {
        const stripWww = (host: string) => host.replace(/^www\./, '')
        if (stripWww(requestHost) === stripWww(canonicalHost)) {
          const target = request.nextUrl.clone()
          target.host = canonicalHost
          return NextResponse.redirect(target, 308)
        }
      }
    } catch {
      // ignore invalid NEXT_PUBLIC_APP_URL
    }
  }

  const excludedVpnPaths = [
    '/vpn-blocked',
    '/api/webhooks',
    '/api/bots/discord/admin',
    '/api/admin/bot',
    '/api/internal',
    '/api/auth',
    '/auth',
    '/api/verify',
    '/verify',
    '/api/manifests/upload',
    '/api/notifications',
  ]

  let isExcludedVpn = verifyUptimeMonitorFromRequest(request)
    || isAdmin
    || excludedVpnPaths.some((p) => request.nextUrl.pathname.startsWith(p))

  // Handle CORS preflight before the VPN gate. Browser preflights do not carry
  // the API key itself, so blocking them here makes valid v2 API calls look like
  // generic CORS failures.
  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    applyApiCors(res, request, true)
    return res
  }

  // System API keys on path-key or header-auth routes (handler validates against DB).
  if (!isExcludedVpn && shouldBypassVpnForApiKeyRequest(request)) {
    isExcludedVpn = true
  }

  // Exclude known crawler / link-preview bots (TelegramBot, Twitterbot, etc.)
  // so Open Graph unfurling works correctly without being VPN-blocked.
  if (!isExcludedVpn) {
    const ua = (request.headers.get('user-agent') || '').toLowerCase()
    const isBotUserAgent =
      ua.includes('telegrambot') ||
      ua.includes('twitterbot') ||
      ua.includes('facebookexternalhit') ||
      ua.includes('linkedinbot') ||
      ua.includes('discordbot') ||
      ua.includes('slackbot') ||
      ua.includes('whatsapp') ||
      ua.includes('google') ||
      ua.includes('bingbot') ||
      ua.includes('yandex') ||
      ua.includes('applebot')
    if (isBotUserAgent) {
      isExcludedVpn = true
    }
  }

  if (!isExcludedVpn) {
    const ip = getClientIp(request)
    if (ip !== 'unknown') {
      const isProxy = await isVpnOrProxy(request, ip)
      if (isProxy) {
        // Return 403 JSON for API routes so frontend can catch it if needed,
        // or redirect for page navigations to force the user to see the block screen.
        if (request.nextUrl.pathname.startsWith('/api/')) {
          const res = new NextResponse(JSON.stringify({ error: "VPN_BLOCKED", redirect: "/vpn-blocked" }), {
            status: 403, 
            headers: { 'Content-Type': 'application/json', 'X-VPN-Blocked': '1' } 
          })
          applyApiCors(res, request, false)
          return res
        }
        return NextResponse.redirect(new URL('/vpn-blocked', request.url))
      }
    }
  }

  let response
  if (request.method === 'POST' && !request.headers.has('origin')) {
    const requestHeaders = new Headers(request.headers)
    const proto = requestHeaders.get('x-forwarded-proto') || request.nextUrl.protocol || 'https'
    const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
    if (host) {
      requestHeaders.set('origin', `${proto.replace(/:$/, '')}://${host}`)
    } else {
      requestHeaders.set('origin', appUrl)
    }

    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  } else {
    response = NextResponse.next()
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    applyApiCors(response, request, false)
  }

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
