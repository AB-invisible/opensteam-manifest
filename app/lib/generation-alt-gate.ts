import { prisma } from '@/app/lib/prisma'

/**
 * Alt-account checks for /gen and web generation.
 * Keep in sync with scripts/lib/generation-alt-gate.js
 */

export function isUsableIpForAltMatch(ip: string | null | undefined): boolean {
  const value = String(ip || '').trim().toLowerCase()
  if (!value || value === 'unknown' || value === 'localhost') return false
  if (value === '127.0.0.1' || value === '::1') return false
  if (value.includes(':')) {
    return !value.startsWith('fe80:') && !value.startsWith('fc') && !value.startsWith('fd')
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  if (a === 10 || a === 127) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 169 && b === 254) return false
  return true
}

async function hasStaffApprovedAltReview(discordId: string): Promise<boolean> {
  const sessions = await prisma.discordVerificationSession.findMany({
    where: { discordId: String(discordId), status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 5,
    select: { riskFlags: true },
  })
  for (const session of sessions) {
    const review = (session.riskFlags as any)?.altReview
    if (review?.status === 'approved') return true
  }
  return false
}

export type GenerationAltMatch = {
  id: string
  username: string
  discordId: string
  matchType: string
}

export async function findVerifiedAltForGeneration(user: {
  id: string
  discordId: string
  role: string
  securityBypass?: boolean | null
  verifyFingerprint?: string | null
  fingerprint?: string | null
  email?: string | null
  verifyIp?: string | null
}): Promise<GenerationAltMatch | null> {
  if (!user?.id) return null
  if (user.securityBypass) return null
  if (user.role === 'ADMIN' || user.role === 'OWNER') return null

  if (await hasStaffApprovedAltReview(user.discordId)) return null

  const fingerprint = String(user.verifyFingerprint || user.fingerprint || '').trim()
  if (fingerprint) {
    const alt = await prisma.user.findFirst({
      where: {
        id: { not: user.id },
        discordVerifiedAt: { not: null },
        OR: [{ verifyFingerprint: fingerprint }, { fingerprint }],
      },
      select: { id: true, username: true, discordId: true },
    })
    if (alt) return { ...alt, matchType: 'device fingerprint' }
  }

  const email = String(user.email || '').trim()
  if (email) {
    const alt = await prisma.user.findFirst({
      where: {
        id: { not: user.id },
        discordVerifiedAt: { not: null },
        email: { equals: email, mode: 'insensitive' },
      },
      select: { id: true, username: true, discordId: true },
    })
    if (alt) return { ...alt, matchType: 'email' }
  }

  const verifyIp = String(user.verifyIp || '').trim()
  if (isUsableIpForAltMatch(verifyIp)) {
    const alt = await prisma.user.findFirst({
      where: {
        id: { not: user.id },
        discordVerifiedAt: { not: null },
        verifyIp,
      },
      select: { id: true, username: true, discordId: true },
    })
    if (alt) return { ...alt, matchType: 'network' }
  }

  return null
}

export function buildGenerationAltBlockMessage(alt: GenerationAltMatch): string {
  return (
    `Alt account blocked. Another verified account (**${alt.username}**) matched on ${alt.matchType}. ` +
    'Use your original account — alt accounts cannot generate.'
  )
}
