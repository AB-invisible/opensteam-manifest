import { prisma } from '@/app/lib/prisma'
import type { AltDetectionResult } from '@/app/lib/verify-alt-detection'

export type VerificationAltBlockMode = 'off' | 'strong' | 'any' | 'custom'

export type VerificationAltBlockPolicy = {
  mode: VerificationAltBlockMode
  customFlags: string[]
}

export type VerificationAltBlockDecision = {
  blocked: boolean
  mode: VerificationAltBlockMode
  blockedFlags: string[]
  matchedFlags: string[]
}

export type VerificationAltReviewStatus = 'pending' | 'approved' | 'rejected'

export type VerificationAltReviewState = {
  status: VerificationAltReviewStatus
  requestedAt?: string
  reviewedAt?: string
  reviewedBy?: string
  notes?: string
  mode?: VerificationAltBlockMode
  blockedFlags?: string[]
  matchedFlags?: string[]
}

const STRONG_ALT_FLAGS = new Set([
  'fingerprint_match',
  'email_match',
  'friend_fingerprint_match',
])

const ALT_FLAG_LABELS: Record<string, string> = {
  ip_match: 'shared network/IP with another account',
  fingerprint_match: 'shared browser/device fingerprint with another account',
  email_match: 'same Discord email as another account',
  friend_fingerprint_match: 'friend graph matched a shared fingerprint',
  friend_of_banned: 'friend graph matched a banned account',
}

async function getConfigValue(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  const fromDb = row?.value?.trim()
  if (fromDb) return fromDb
  const fromEnv = process.env[key]?.trim()
  return fromEnv || null
}

export function parseVerificationAltBlockMode(raw?: string | null): VerificationAltBlockMode {
  const value = String(raw || '').trim().toLowerCase()
  if (!value || value === 'off' || value === 'false' || value === 'disabled' || value === 'none' || value === 'observe') {
    return 'off'
  }
  if (value === 'strong' || value === 'strict' || value === 'true' || value === 'enabled' || value === 'on') {
    return 'strong'
  }
  if (value === 'any' || value === 'all') return 'any'
  if (value === 'custom') return 'custom'
  return 'off'
}

export function parseAltBlockFlags(raw?: string | null): string[] {
  return [
    ...new Set(
      String(raw || '')
        .split(',')
        .map((flag) => flag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}

export async function getVerificationAltBlockPolicy(): Promise<VerificationAltBlockPolicy> {
  const [mode, flags] = await Promise.all([
    getConfigValue('DISCORD_VERIFY_ALT_BLOCK_MODE'),
    getConfigValue('DISCORD_VERIFY_ALT_BLOCK_FLAGS'),
  ])

  return {
    mode: parseVerificationAltBlockMode(mode),
    customFlags: parseAltBlockFlags(flags),
  }
}

export function evaluateVerificationAltBlock(
  altResult: Pick<AltDetectionResult, 'flags' | 'altMatchedUserIds'>,
  policy: VerificationAltBlockPolicy,
): VerificationAltBlockDecision {
  const matchedFlags = [...new Set(altResult.flags.map((flag) => flag.trim()).filter(Boolean))]
  if (altResult.altMatchedUserIds.length === 0 || matchedFlags.length === 0 || policy.mode === 'off') {
    return { blocked: false, mode: policy.mode, blockedFlags: [], matchedFlags }
  }

  let blockableFlags: string[] = []
  if (policy.mode === 'any') {
    blockableFlags = matchedFlags
  } else if (policy.mode === 'strong') {
    blockableFlags = matchedFlags.filter((flag) => STRONG_ALT_FLAGS.has(flag))
  } else if (policy.mode === 'custom') {
    const custom = new Set(policy.customFlags)
    blockableFlags = matchedFlags.filter((flag) => custom.has(flag))
  }

  return {
    blocked: blockableFlags.length > 0,
    mode: policy.mode,
    blockedFlags: blockableFlags,
    matchedFlags,
  }
}

export function buildAltBlockMessage(
  flags: string[],
  matchedAccounts?: Array<{ username: string; discordId: string; inGuild?: boolean }>,
): string {
  const inGuild = matchedAccounts?.filter((account) => account.inGuild) ?? []
  if (inGuild.length > 0) {
    const mentions = inGuild.map((account) => `<@${account.discordId}> (${account.username})`).join(', ')
    return `Alt account blocked. You already have an account in this server: ${mentions}. Use that account — alt accounts cannot verify.`
  }

  const labels = flags.map((flag) => ALT_FLAG_LABELS[flag] || flag.replace(/_/g, ' '))
  const reason = labels.length ? ` Reason: ${labels.join(', ')}.` : ''

  if (matchedAccounts?.length) {
    const names = matchedAccounts
      .map((account) => `**${account.username}** (\`${account.discordId}\`)`)
      .join(', ')
    return `Alt account blocked. This matches existing OpenSteam account(s): ${names}. Alt accounts cannot verify.${reason}`
  }

  return `Verification blocked because this account matches an existing OpenSteam account.${reason} Staff must approve this verification before it can continue.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getVerificationAltReviewState(riskFlags: unknown): VerificationAltReviewState | null {
  if (!isRecord(riskFlags) || !isRecord(riskFlags.altReview)) return null
  const review = riskFlags.altReview
  const status = String(review.status || '')
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') return null

  return {
    status,
    requestedAt: typeof review.requestedAt === 'string' ? review.requestedAt : undefined,
    reviewedAt: typeof review.reviewedAt === 'string' ? review.reviewedAt : undefined,
    reviewedBy: typeof review.reviewedBy === 'string' ? review.reviewedBy : undefined,
    notes: typeof review.notes === 'string' ? review.notes : undefined,
    mode: parseVerificationAltBlockMode(typeof review.mode === 'string' ? review.mode : undefined),
    blockedFlags: Array.isArray(review.blockedFlags) ? review.blockedFlags.map(String) : undefined,
    matchedFlags: Array.isArray(review.matchedFlags) ? review.matchedFlags.map(String) : undefined,
  }
}

export function mergeVerificationAltReviewState(
  riskFlags: unknown,
  altReview: VerificationAltReviewState,
): Record<string, unknown> {
  return {
    ...(isRecord(riskFlags) ? riskFlags : {}),
    altReview,
  }
}
