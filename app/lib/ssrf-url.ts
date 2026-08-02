const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

function isPrivateOrLocalIpv4(a: number, b: number): boolean {
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || a === 0;
}

function isBlockedIpv4Host(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }
  return isPrivateOrLocalIpv4(parts[0], parts[1]);
}

function isBlockedIpv6Host(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === '::1'
    || lower.startsWith('fe80:')
    || lower.startsWith('fc')
    || lower.startsWith('fd')
    || lower.startsWith('[::1]');
}

/**
 * Validates outbound webhook URLs to reduce SSRF risk.
 */
export function validateWebhookUrl(rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'Invalid webhook URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Webhook URL must use HTTPS.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Webhook URL must not include credentials.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, error: 'Webhook URL must include a hostname.' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    return { ok: false, error: 'Webhook hostname is not allowed.' };
  }

  if (hostname.includes(':') ? isBlockedIpv6Host(hostname) : isBlockedIpv4Host(hostname)) {
    return { ok: false, error: 'Webhook URL must not target private or local networks.' };
  }

  return { ok: true, url: parsed.toString() };
}
