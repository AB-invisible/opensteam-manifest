import { prisma } from '@/app/lib/prisma'

export const INACTIVITY_MS = 4 * 24 * 60 * 60 * 1000

export function isWebSessionInactive(lastWebActivityAt: Date | null | undefined): boolean {
  if (!lastWebActivityAt) return false
  return Date.now() - lastWebActivityAt.getTime() > INACTIVITY_MS
}

export function assertWebActivityFresh(user: {
  lastWebActivityAt?: Date | null
}): { ok: true } | { ok: false; reason: 'inactivity' } {
  if (isWebSessionInactive(user.lastWebActivityAt)) {
    return { ok: false, reason: 'inactivity' }
  }
  return { ok: true }
}

export async function touchWebActivity(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastWebActivityAt: new Date() },
  })
}
