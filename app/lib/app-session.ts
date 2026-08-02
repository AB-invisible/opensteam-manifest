import { prisma } from '@/app/lib/prisma';

export const APP_SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAppSessionId(id: string): boolean {
  return APP_SESSION_ID_RE.test(id);
}

export async function assertAppSessionOwnership(
  sessionId: string,
  apiKeyId: string
): Promise<{ ok: true } | { ok: false; status: 400 | 403 }> {
  if (!isValidAppSessionId(sessionId)) {
    return { ok: false, status: 400 };
  }

  const existingSession = await prisma.appSession.findUnique({ where: { id: sessionId } });
  if (existingSession && existingSession.apiKeyId !== apiKeyId) {
    return { ok: false, status: 403 };
  }

  return { ok: true };
}
