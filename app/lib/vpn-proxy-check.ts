import { isPublicIp, normalizeIp } from '@/app/lib/ip';

// Simple in-memory cache for Edge (survives as long as the isolate is warm)
const vpnCache = new Map<string, { isProxy: boolean; expires: number }>();

export async function isVpnOrProxy(_request: Request, ip: string): Promise<boolean> {
  const normalizedIp = normalizeIp(ip);
  if (!isPublicIp(normalizedIp)) {
    return false;
  }

  const now = Date.now();
  const cached = vpnCache.get(normalizedIp);
  if (cached && cached.expires > now) {
    return cached.isProxy;
  }

  let isProxyResult = false;
  try {
    // API 1: blackbox.ipinfo.app (Free, fast, no strict rate limit)
    const bbController = new AbortController();
    const bbTimeoutId = setTimeout(() => bbController.abort(), 1500);
    const bbRes = await fetch(`https://blackbox.ipinfo.app/lookup/${normalizedIp}`, {
      signal: bbController.signal,
    }).catch(() => null);
    clearTimeout(bbTimeoutId);

    if (bbRes && bbRes.ok) {
      const text = await bbRes.text();
      if (text.trim() === 'Y') isProxyResult = true;
      if (text.trim() === 'N') isProxyResult = false;
    }

    if (!isProxyResult) {
      // API 2: ip-api.com — only explicit proxy flag (hosting causes false positives)
      const ipapiController = new AbortController();
      const ipapiTimeoutId = setTimeout(() => ipapiController.abort(), 1500);
      const ipapiRes = await fetch(
        `http://ip-api.com/json/${normalizedIp}?fields=status,proxy,message`,
        { signal: ipapiController.signal }
      ).catch(() => null);
      clearTimeout(ipapiTimeoutId);

      if (ipapiRes && ipapiRes.ok) {
        const data = await ipapiRes.json();
        if (data.status === 'success' && data.proxy === true) {
          isProxyResult = true;
        }
      }
    }

    if (!isProxyResult) {
      // API 3: proxycheck.io (Strict rate limits on free tier, good fallback)
      const pcController = new AbortController();
      const pcTimeoutId = setTimeout(() => pcController.abort(), 1500);
      const pcRes = await fetch(`https://proxycheck.io/v2/${normalizedIp}?vpn=1&asn=1`, {
        signal: pcController.signal,
        headers: { Accept: 'application/json' },
      }).catch(() => null);
      clearTimeout(pcTimeoutId);

      if (pcRes && pcRes.ok) {
        const data = await pcRes.json();
        const entry = data[normalizedIp] ?? Object.values(data).find((value) => typeof value === 'object') as
          | { proxy?: string; type?: string }
          | undefined;
        if (data.status === 'ok' && entry) {
          if (entry.proxy === 'yes' || entry.type === 'VPN') {
            isProxyResult = true;
          }
        }
      }
    }
  } catch (error) {
    console.error('VPN Check API Error:', error);
  }

  vpnCache.set(normalizedIp, { isProxy: isProxyResult, expires: now + 30 * 60 * 1000 });

  if (vpnCache.size > 5000) {
    for (const [key, val] of vpnCache.entries()) {
      if (val.expires < now) vpnCache.delete(key);
    }
  }

  return isProxyResult;
}
