import { NextRequest } from 'next/server';
import { safeKeyEquals } from '@/app/lib/safe-compare';
import { parseBearerToken } from '@/app/lib/bearer-auth';

export function getAdminApiKey(): string | null {
  const key = process.env.ADMIN_API_KEY?.trim();
  return key || null;
}

/** Timing-safe admin key check from Authorization Bearer or X-API-Key. */
export function verifyAdminApiKeyFromRequest(request: NextRequest): boolean {
  const adminKey = getAdminApiKey();
  if (!adminKey) return false;

  const bearer = parseBearerToken(request.headers.get('Authorization'));
  const headerKey = request.headers.get('X-API-Key')?.trim();
  const candidate = bearer || headerKey;

  if (!candidate) return false;
  return safeKeyEquals(candidate, adminKey);
}

/** Signed uptime monitor bypass (replaces spoofable User-Agent strings). */
export function verifyUptimeMonitorFromRequest(request: NextRequest): boolean {
  const secret = process.env.UPTIME_MONITOR_SECRET?.trim();
  if (!secret) return false;

  const provided = request.headers.get('x-uptime-monitor-secret')?.trim();
  if (!provided) return false;

  return safeKeyEquals(provided, secret);
}
