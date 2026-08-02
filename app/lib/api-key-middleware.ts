import { NextRequest } from 'next/server';
import { internalServiceAuthHeaders } from '@/app/lib/internal-service-headers';
import {
  looksLikeApiKey,
  parseBearerApiKey,
  shouldBypassVpnForApiKeyRequest,
} from '@/app/lib/api-key-edge';
import { isLocalhostHost } from '@/app/lib/app-hosts';
import { safeKeyEquals } from '@/app/lib/safe-compare';

export { looksLikeApiKey, parseBearerApiKey, shouldBypassVpnForApiKeyRequest };

const VALID_KEY_CACHE = new Map<string, { valid: boolean; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function isCrossOriginBrowserRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') return true;

  const origin = request.headers.get('origin');
  if (!origin) return false;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return true;

  try {
    return new URL(origin).host !== host.split(',')[0].trim();
  } catch {
    return true;
  }
}

export function isInsecureTransport(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  const host = (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();
  // Local OpenSteam dev (127.0.0.1:3000) runs HTTP — pairing works but Bearer auth must too.
  if (isLocalhostHost(host)) return false;
  const proto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')).toLowerCase();
  return proto !== 'https';
}

export type ApiKeyResolveResult =
  | { ok: true; key: string }
  | { ok: false; status: 401 | 403; error: string; code: string };

/**
 * Resolve API key from path param, X-API-Key, or Authorization Bearer.
 * Rejects hijack patterns: cross-origin browser, HTTP, key mismatch, loose Bearer.
 */
export function resolveApiKeyFromRequest(
  request: NextRequest,
  providedKey?: string | null
): ApiKeyResolveResult {
  if (isInsecureTransport(request)) {
    return {
      ok: false,
      status: 403,
      error: 'API keys must be sent over HTTPS.',
      code: 'INSECURE_TRANSPORT',
    };
  }

  if (isCrossOriginBrowserRequest(request)) {
    return {
      ok: false,
      status: 403,
      error: 'API key authentication is blocked from cross-origin browser requests. Use server-side clients only.',
      code: 'BROWSER_AUTH_BLOCKED',
    };
  }

  const pathKey = providedKey?.trim() && looksLikeApiKey(providedKey.trim()) ? providedKey.trim() : null;
  const headerKeyRaw = request.headers.get('X-API-Key')?.trim();
  const headerKey = headerKeyRaw && looksLikeApiKey(headerKeyRaw) ? headerKeyRaw : null;
  const bearerKey = parseBearerApiKey(request.headers.get('Authorization'));

  const rawAuth = request.headers.get('Authorization')?.trim();
  if (rawAuth && !bearerKey) {
    return {
      ok: false,
      status: 401,
      error: 'Authorization must use Bearer with a valid system API key.',
      code: 'INVALID_BEARER',
    };
  }

  if (headerKeyRaw && !headerKey) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid X-API-Key format.',
      code: 'INVALID_API_KEY',
    };
  }

  const present = [pathKey, headerKey, bearerKey].filter(Boolean) as string[];
  if (present.length === 0) {
    return {
      ok: false,
      status: 401,
      error: 'API key required.',
      code: 'MISSING_API_KEY',
    };
  }

  const unique = new Set(present);
  if (unique.size > 1) {
    return {
      ok: false,
      status: 403,
      error: 'API key mismatch between URL path and headers.',
      code: 'KEY_MISMATCH',
    };
  }

  return { ok: true, key: present[0] };
}

export { safeKeyEquals };

/** Extract API key for middleware VPN bypass (same validation rules as auth). */
export function extractApiKeyFromRequest(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split('/');
  const pathCandidate = segments[1] === 'api' && segments.length > 2 ? segments[2] : null;
  const resolved = resolveApiKeyFromRequest(request, pathCandidate);
  return resolved.ok ? resolved.key : null;
}

/** True when request targets a public API route that bots use with keys. */
export function isBotApiRoute(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  return !pathname.startsWith('/api/admin') && !pathname.startsWith('/api/internal');
}

/**

 * Confirms key exists, is enabled, and belongs to an active user (cached).
 * Do not call from middleware — use shouldBypassVpnForApiKeyRequest instead.
 */
export async function isValidApiKeyForVpnBypass(request: NextRequest, key: string): Promise<boolean> {
  if (!looksLikeApiKey(key)) return false;

  const now = Date.now();
  const cached = VALID_KEY_CACHE.get(key);
  if (cached && cached.expires > now) return cached.valid;

  const authHeaders = internalServiceAuthHeaders();
  if (!authHeaders['x-internal-secret']) return false;

  try {
    const res = await fetch(
      `${request.nextUrl.origin}/api/internal/check-key?key=${encodeURIComponent(key)}`,
      {
        headers: authHeaders,
        signal: AbortSignal.timeout(2500),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      VALID_KEY_CACHE.set(key, { valid: false, expires: now + 60_000 });
      return false;
    }

    const data = (await res.json()) as { valid?: boolean };
    const valid = data.valid === true;
    VALID_KEY_CACHE.set(key, { valid, expires: now + CACHE_TTL_MS });

    if (VALID_KEY_CACHE.size > 2000) {
      for (const [k, v] of VALID_KEY_CACHE.entries()) {
        if (v.expires < now) VALID_KEY_CACHE.delete(k);
      }
    }

    return valid;
  } catch {
    return false;
  }
}
