import crypto from 'crypto';
import { getInternalServiceSecret } from '@/app/lib/internal-service-headers';

export { getInternalServiceSecret, internalServiceAuthHeaders } from '@/app/lib/internal-service-headers';

export function verifyInternalServiceSecret(provided: string | null | undefined): boolean {
  const expected = getInternalServiceSecret();
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

