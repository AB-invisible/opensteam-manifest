import { safeKeyEquals } from '@/app/lib/safe-compare';

/** Strict Bearer parsing — rejects raw Authorization values and malformed tokens. */
export function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.trim()) return null;
  const match = authHeader.trim().match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export function verifyBearerSecret(
  authHeader: string | null,
  expected: string | null | undefined
): boolean {
  const expectedTrimmed = expected?.trim();
  if (!expectedTrimmed) return false;
  const presented = parseBearerToken(authHeader);
  if (!presented) return false;
  return safeKeyEquals(presented, expectedTrimmed);
}
