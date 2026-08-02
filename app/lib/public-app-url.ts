import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { isLocalOpenSteamHost, isLocalhostHost, isTunnelHost } from './app-hosts'

const PRODUCTION_FALLBACK = 'https://opensteam.lol'
const LOCAL_SITE_URL = 'https://opensteam.lol'
const TUNNEL_URL_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop',
  'opensteam-web-data',
  'public-url.txt'
)

function trimUrl(raw: string): string {
  return raw.replace(/\/$/, '')
}

function isLocalhostUrl(url: string): boolean {
  try {
    return isLocalhostHost(new URL(url).host)
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url)
  }
}

export { isTunnelHost, isLocalOpenSteamHost } from './app-hosts'

export function readPublicTunnelUrl(): string | null {
  const nextAuth = process.env.NEXTAUTH_URL?.trim()
  if (nextAuth && !isLocalhostUrl(nextAuth) && !nextAuth.includes('trycloudflare.com')) {
    return trimUrl(nextAuth)
  }

  const fromEnv = process.env.PUBLIC_TUNNEL_URL?.trim()
  if (fromEnv && !fromEnv.includes('api.trycloudflare.com') && !fromEnv.includes('trycloudflare.com')) {
    return trimUrl(fromEnv)
  }

  try {
    if (TUNNEL_URL_FILE && fs.existsSync(TUNNEL_URL_FILE)) {
      const fromFile = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim()
      if (fromFile && !fromFile.includes('trycloudflare.com')) return trimUrl(fromFile)
    }
  } catch {
    // ignore on edge/serverless
  }

  return null
}

function requestHost(request?: NextRequest): string {
  if (!request) return ''
  return (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase()
}

function requestOrigin(request?: NextRequest): string | null {
  if (!request) return null
  const host = requestHost(request)
  if (!host || isLocalhostHost(host)) return null
  const proto = (
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '') ||
    'https'
  )
    .split(',')[0]
    .trim()
    .toLowerCase()
  return `${proto}://${host}`
}

/**
 * User-facing absolute URL from env. Production requires NEXT_PUBLIC_APP_URL (no localhost fallback).
 */
export function getPublicAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (raw) {
    if (process.env.NODE_ENV === 'production' && isLocalhostUrl(raw)) return null
    return trimUrl(raw)
  }
  if (process.env.NODE_ENV === 'production') return null
  const nextAuth = process.env.NEXTAUTH_URL?.trim()
  if (nextAuth) return trimUrl(nextAuth)
  return 'http://localhost:3000'
}

/**
 * Resolve the public site origin for redirects and absolute links.
 * Tunnel visitors use the tunnel host; local owner uses opensteam.lol.
 */
export function resolvePublicAppUrl(request?: NextRequest): string {
  const host = requestHost(request)
  if (host && isTunnelHost(host)) {
    return requestOrigin(request) || readPublicTunnelUrl() || getPublicAppUrl() || PRODUCTION_FALLBACK
  }

  if (host && isLocalOpenSteamHost(host)) {
    return requestOrigin(request) || LOCAL_SITE_URL
  }

  const tunnelUrl = readPublicTunnelUrl()
  if (tunnelUrl && !request) return tunnelUrl

  const fromEnv = getPublicAppUrl()
  if (fromEnv) return fromEnv

  if (request) {
    const origin = requestOrigin(request)
    if (origin) return origin
  }

  const nextAuth = process.env.NEXTAUTH_URL?.trim()
  if (nextAuth && !isLocalhostUrl(nextAuth)) return trimUrl(nextAuth)

  if (process.env.NODE_ENV === 'production') return PRODUCTION_FALLBACK
  return 'http://localhost:3000'
}

/** Build an absolute redirect URL using the public site origin, not the internal request URL. */
export function publicAppRedirect(request: NextRequest, path: string): URL {
  return new URL(path, `${resolvePublicAppUrl(request)}/`)
}

export function getLocalSiteUrl(): string {
  return LOCAL_SITE_URL
}

export function getShareablePublicUrl(): string {
  return readPublicTunnelUrl() || getPublicAppUrl() || PRODUCTION_FALLBACK
}

function isLocalInternalAppUrl(raw: string | undefined): boolean {
  if (!raw) return false
  try {
    return isLocalhostHost(new URL(raw).host)
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/i.test(raw)
  }
}

/**
 * OAuth + verify links use the public tunnel URL when available.
 */
export function resolveOAuthSiteUrl(): string {
  const tunnelUrl = readPublicTunnelUrl()
  if (tunnelUrl) return tunnelUrl

  if (isLocalInternalAppUrl(process.env.INTERNAL_APP_URL?.trim())) {
    const nextAuth = process.env.NEXTAUTH_URL?.trim()
    if (nextAuth && !isLocalhostUrl(nextAuth)) return trimUrl(nextAuth)
    return LOCAL_SITE_URL
  }
  return resolvePublicAppUrl()
}
