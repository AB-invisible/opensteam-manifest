import { safeKeyEquals } from '@/app/lib/safe-compare';
import { getRuntimeSecret } from '@/app/lib/runtime-secrets';

export async function getTelegramWebhookSecret(): Promise<string | null> {
  return getRuntimeSecret('TELEGRAM_WEBHOOK_SECRET');
}

export function verifyTelegramWebhookSecret(
  provided: string | null | undefined,
  expected: string
): boolean {
  if (!provided) return false;
  return safeKeyEquals(provided, expected);
}
