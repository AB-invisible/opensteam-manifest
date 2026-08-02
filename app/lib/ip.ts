import { NextRequest } from 'next/server';

type TrustedProxy = 'cloudflare' | 'vercel' | 'railway' | 'none';

function getTrustedProxy(): TrustedProxy {
  const value = process.env.TRUSTED_PROXY?.trim().toLowerCase();
  if (value === 'cloudflare' || value === 'vercel' || value === 'railway') return value;
  return 'none';
}

function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (ip.includes('::ffff:')) {
    ip = ip.split('::ffff:')[1];
  }
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  return ip;
}

function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip || ip === 'unknown' || ip === 'localhost') return true;

  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower === '::1'
      || lower.startsWith('fe80:')
      || lower.startsWith('fc')
      || lower.startsWith('fd');
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

function isPublicIp(ip: string): boolean {
  return !isPrivateOrLocalIp(ip);
}

function firstPublicIpFromForwarded(forwarded: string | null): string | null {
  if (!forwarded) return null;
  for (const part of forwarded.split(',')) {
    const ip = normalizeIp(part);
    if (isPublicIp(ip)) return ip;
  }
  return null;
}

/** Only true when deployment explicitly trusts Cloudflare as edge (not client cf-ray). */
export function isCloudflareTrusted(getHeader: (name: string) => string | null): boolean {
  return getTrustedProxy() === 'cloudflare' && Boolean(getHeader('cf-connecting-ip')?.trim());
}

function tryCfConnectingIp(getHeader: (name: string) => string | null): string | null {
  const cfIp = getHeader('cf-connecting-ip');
  if (!cfIp) return null;
  const ip = normalizeIp(cfIp);
  return isPublicIp(ip) ? ip : null;
}

function extractClientIp(getHeader: (name: string) => string | null, fallbackIp?: string | null): string {
  const proxy = getTrustedProxy();

  // Cloudflare Tunnel / orange-cloud sends cf-connecting-ip on Railway too.
  if (proxy === 'cloudflare' || proxy === 'railway') {
    const cfIp = tryCfConnectingIp(getHeader);
    if (cfIp) return cfIp;
  }

  if (proxy === 'cloudflare') {
    // Never use x-real-ip here — often the cloudflared hop, not the visitor.
    if (fallbackIp) {
      const ip = normalizeIp(fallbackIp);
      if (isPublicIp(ip)) return ip;
    }
    return 'unknown';
  }

  if (proxy === 'vercel') {
    const vercelIp = firstPublicIpFromForwarded(getHeader('x-vercel-forwarded-for'));
    if (vercelIp) return vercelIp;
  }

  if (proxy === 'railway') {
    // Prefer XFF client over x-real-ip (tunnel / edge hop).
    const forwardedIp = firstPublicIpFromForwarded(getHeader('x-forwarded-for'));
    if (forwardedIp) return forwardedIp;
    const realIp = getHeader('x-real-ip');
    if (realIp) {
      const ip = normalizeIp(realIp);
      if (isPublicIp(ip)) return ip;
    }
  }

  if (fallbackIp) {
    const ip = normalizeIp(fallbackIp);
    if (isPublicIp(ip)) return ip;
  }

  return 'unknown';
}

export type SecurityContext = {
  ip: string;
  country: string;
  rayId: string;
  city: string | null;
  region: string | null;
  timezone: string | null;
  continent: string | null;
  forwardedFor: string | null;
  cfConnectingIp: string | null;
  trueClientIp: string | null;
  behindCloudflare: boolean;
  userAgent: string | null;
  referer: string | null;
  host: string | null;
  path: string | null;
};

function buildSecurityContext(
  getHeader: (name: string) => string | null,
  extras?: { path?: string | null; userAgent?: string | null; referer?: string | null; host?: string | null }
): SecurityContext {
  const cloudflareTrusted = isCloudflareTrusted(getHeader);

  return {
    ip: extractClientIp(getHeader),
    country: cloudflareTrusted
      ? (getHeader('cf-ipcountry') || 'XX')
      : (getHeader('x-vercel-ip-country') || getHeader('x-railway-ip-country') || 'XX'),
    rayId: cloudflareTrusted ? (getHeader('cf-ray') || '—') : '—',
    city: cloudflareTrusted ? (getHeader('cf-ipcity') || null) : null,
    region: cloudflareTrusted ? (getHeader('cf-region') || getHeader('cf-ipregion') || null) : null,
    timezone: cloudflareTrusted ? (getHeader('cf-timezone') || null) : null,
    continent: cloudflareTrusted ? (getHeader('cf-ipcontinent') || null) : null,
    forwardedFor: getHeader('x-forwarded-for') || getHeader('x-vercel-forwarded-for') || null,
    cfConnectingIp: cloudflareTrusted && getHeader('cf-connecting-ip')
      ? normalizeIp(getHeader('cf-connecting-ip')!)
      : null,
    trueClientIp: null,
    behindCloudflare: cloudflareTrusted,
    userAgent: extras?.userAgent ?? getHeader('user-agent'),
    referer: extras?.referer ?? getHeader('referer'),
    host: extras?.host ?? getHeader('host'),
    path: extras?.path ?? null,
  };
}

/** Flat object for Discord webhooks / DB logs. Omits null/empty values. */
export function securityContextToLogPayload(ctx: SecurityContext): Record<string, string> {
  const payload: Record<string, string> = {
    ip: ctx.ip,
    country: ctx.country,
    rayId: ctx.rayId,
    behindCloudflare: ctx.behindCloudflare ? 'yes' : 'no',
  };

  if (ctx.city) payload.city = ctx.city;
  if (ctx.region) payload.region = ctx.region;
  if (ctx.timezone) payload.timezone = ctx.timezone;
  if (ctx.continent) payload.continent = ctx.continent;
  if (ctx.forwardedFor) payload.forwardedFor = ctx.forwardedFor;
  if (ctx.cfConnectingIp) payload.cfConnectingIp = ctx.cfConnectingIp;
  if (ctx.trueClientIp) payload.trueClientIp = ctx.trueClientIp;
  if (ctx.userAgent) payload.userAgent = ctx.userAgent;
  if (ctx.referer) payload.referer = ctx.referer;
  if (ctx.host) payload.host = ctx.host;
  if (ctx.path) payload.path = ctx.path;

  return payload;
}

export function getSecurityContextFromHeaders(
  headersList: Headers,
  extras?: { path?: string | null }
): SecurityContext {
  return buildSecurityContext((name) => headersList.get(name), {
    path: extras?.path ?? null,
    userAgent: headersList.get('user-agent'),
    referer: headersList.get('referer'),
    host: headersList.get('host'),
  });
}

export function getSecurityContextFromRequest(
  request: NextRequest,
  extras?: { path?: string | null }
): SecurityContext {
  return buildSecurityContext(
    (name) => request.headers.get(name),
    {
      path: extras?.path ?? request.nextUrl.pathname,
      userAgent: request.headers.get('user-agent'),
      referer: request.headers.get('referer'),
      host: request.headers.get('host'),
    }
  );
}

export function getClientIp(request: NextRequest): string {
  return extractClientIp(
    (name) => request.headers.get(name),
    (request as NextRequest & { ip?: string }).ip ?? null
  );
}

export function getClientIpFromHeaders(headersList: Headers): string {
  return extractClientIp((name) => headersList.get(name));
}

export type ConnectionDetails = Pick<SecurityContext, 'ip' | 'country' | 'rayId'>;

export function getConnectionDetailsFromHeaders(headersList: Headers): ConnectionDetails {
  const ctx = getSecurityContextFromHeaders(headersList);
  return { ip: ctx.ip, country: ctx.country, rayId: ctx.rayId };
}

export function getConnectionDetails(request: NextRequest): ConnectionDetails {
  const ctx = getSecurityContextFromRequest(request);
  return { ip: ctx.ip, country: ctx.country, rayId: ctx.rayId };
}

export function canResolveClientIpForVpnCheck(
  getHeader: (name: string) => string | null,
  fallbackIp?: string | null
): boolean {
  return extractClientIp(getHeader, fallbackIp) !== 'unknown';
}

export { isPublicIp, normalizeIp };

export function getClientCountry(request: NextRequest): string {
  const getHeader = (name: string) => request.headers.get(name);
  if (isCloudflareTrusted(getHeader)) {
    return getHeader('cf-ipcountry') || 'XX';
  }
  return getHeader('x-vercel-ip-country')
    || getHeader('x-railway-ip-country')
    || 'XX';
}
