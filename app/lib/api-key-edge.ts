import { NextRequest } from 'next/server';

/** System-issued API keys only (`mg_` create, `gg_` rotate). */
export function looksLikeApiKey(key: string): boolean {
  if (!key) return false;
  return /^mg_[a-f0-9]{32}$/i.test(key) || /^gg_[a-f0-9]{64}$/i.test(key);
}

/** Strict Bearer parsing — rejects raw Authorization values and malformed tokens. */
export function parseBearerApiKey(authHeader: string | null): string | null {
  if (!authHeader?.trim()) return null;
  const match = authHeader.trim().match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return null;
  const token = match[1];
  return looksLikeApiKey(token) ? token : null;
}

/** Routes that call authenticateApiKey from headers/Bearer (not path segment). */
const HEADER_AUTH_API_PREFIXES = [
  '/api/v2/',
  '/api/request/',
  '/api/download/',
  '/api/user/files/',
  '/api/user/manifests',
  '/api/report',
] as const;

function hasSystemKeyInPath(pathname: string): boolean {
  const segments = pathname.split('/');
  if (segments[1] !== 'api' || segments.length < 3) return false;
  return looksLikeApiKey(segments[2]);
}

function hasSystemKeyInHeaders(request: NextRequest): boolean {
  const headerKey = request.headers.get('X-API-Key')?.trim();
  if (headerKey && looksLikeApiKey(headerKey)) return true;
  return Boolean(parseBearerApiKey(request.headers.get('Authorization')));
}

/**
 * Sync VPN bypass for API traffic that validates keys in the route handler.
 * Edge-safe — no DB fetch from middleware.
 */
export function shouldBypassVpnForApiKeyRequest(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;

  if (hasSystemKeyInPath(pathname)) return true;

  if (!HEADER_AUTH_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return false;
  }

  return hasSystemKeyInHeaders(request);
}
