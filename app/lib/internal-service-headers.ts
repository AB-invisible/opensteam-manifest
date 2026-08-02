/** Edge-safe internal service header helper (no node:crypto). */
export function getInternalServiceSecret(): string | null {
  const secret = process.env.INTERNAL_SERVICE_SECRET?.trim();
  return secret || null;
}

export function internalServiceAuthHeaders(): Record<string, string> {
  const secret = getInternalServiceSecret();
  if (!secret) return {};
  return { 'x-internal-secret': secret };
}
