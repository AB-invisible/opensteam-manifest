/**
 * Parses ALLOWED_ORIGINS (comma-separated). In production, defaults to NEXT_PUBLIC_APP_URL when unset.
 */
export function normalizeAllowedOriginsList(): string[] | '*' {
  const raw = process.env.ALLOWED_ORIGINS?.trim();

  if (raw && raw !== '*') {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }

  if (raw === '*') {
    if (process.env.NODE_ENV === 'production') {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
      return appUrl ? [appUrl] : [];
    }
    return '*';
  }

  if (process.env.NODE_ENV === 'production') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
    return appUrl ? [appUrl] : [];
  }

  return '*';
}

/**
 * Browsers accept a single ACAO value. Echo request Origin only when allow-listed.
 * No Origin (e.g. curl): `*`. Restricted env but unknown/disallowed Origin: omit header (`null`).
 */
export function resolveAccessControlAllowOrigin(
  requestOrigin: string | null | undefined
): string | null {
  const allowed = normalizeAllowedOriginsList();

  if (allowed === '*') return '*';

  if (allowed.length === 0) {
    return requestOrigin ? null : '*';
  }

  if (!requestOrigin) return '*';

  return allowed.includes(requestOrigin) ? requestOrigin : null;
}
