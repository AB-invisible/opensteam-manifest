import { prisma } from '@/app/lib/prisma';

/** Standard UUID or compact 32-hex form (Guid.ToString("N") from the desktop app). */
export const APP_SESSION_ID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

export function normalizeAppSessionId(id: string): string {
  const trimmed = id.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return `${trimmed.slice(0, 8)}-${trimmed.slice(8, 12)}-${trimmed.slice(12, 16)}-${trimmed.slice(16, 20)}-${trimmed.slice(20)}`.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function isValidAppSessionId(id: string): boolean {
  return APP_SESSION_ID_RE.test(id.trim());
}

export async function assertAppSessionOwnership(
  sessionId: string,
  apiKeyId: string
): Promise<{ ok: true; sessionId: string } | { ok: false; status: 400 | 403 }> {
  const normalizedId = normalizeAppSessionId(sessionId);
  if (!isValidAppSessionId(sessionId)) {
    return { ok: false, status: 400 };
  }

  const existingSession = await prisma.appSession.findUnique({ where: { id: normalizedId } });
  if (existingSession && existingSession.apiKeyId !== apiKeyId) {
    return { ok: false, status: 403 };
  }

  return { ok: true, sessionId: normalizedId };
}
