import crypto from 'crypto'
import { prisma } from '@/app/lib/prisma'
import { VerificationSessionStatus } from '@prisma/client'
import { resolveOAuthSiteUrl } from './public-app-url'

const SESSION_TTL_MS = 30 * 60 * 1000

function getStateSecret(): Buffer {
  const hex = process.env.DISCORD_VERIFY_STATE_SECRET || process.env.HOSTED_BOT_ENCRYPTION_KEY
  if (hex && hex.length === 64) {
    return Buffer.from(hex, 'hex')
  }
  const fallback = process.env.NEXTAUTH_SECRET
  if (!fallback) {
    throw new Error('DISCORD_VERIFY_STATE_SECRET, HOSTED_BOT_ENCRYPTION_KEY, or NEXTAUTH_SECRET is required')
  }
  return crypto.createHash('sha256').update(fallback).digest()
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex')
}

export type VerifySessionPayload = {
  id: string
  discordId: string
  guildId: string
  exp: number
}

function buildSignedParam(payload: VerifySessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signPayload(encoded)}`
}

export function parseSignedVerifyParam(s: string): VerifySessionPayload | null {
  const [encoded, sig] = s.split('.')
  if (!encoded || !sig || signPayload(encoded) !== sig) return null

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as VerifySessionPayload
    if (!parsed.id || !parsed.discordId || !parsed.guildId || !parsed.exp) return null
    if (Date.now() > parsed.exp) return null
    return parsed
  } catch {
    return null
  }
}

export async function createVerificationSession(discordId: string, guildId: string) {
  const sessionSecret = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  const session = await prisma.discordVerificationSession.create({
    data: {
      discordId,
      guildId,
      sessionSecret,
      expiresAt,
      status: VerificationSessionStatus.PENDING,
    },
  })

  const signed = buildSignedParam({
    id: session.id,
    discordId,
    guildId,
    exp: expiresAt.getTime(),
  })

  await writeVerificationAudit({
    sessionId: session.id,
    discordId,
    action: 'SESSION_CREATED',
    details: { guildId },
  }).catch(() => {})

  return {
    session,
    signed,
    url: `${resolveOAuthSiteUrl()}/verify?s=${encodeURIComponent(signed)}`,
  }
}

export async function loadVerificationSession(signed: string) {
  const payload = parseSignedVerifyParam(signed)
  if (!payload) return { ok: false as const, reason: 'invalid_or_expired' }

  const session = await prisma.discordVerificationSession.findUnique({
    where: { id: payload.id },
  })

  if (!session) return { ok: false as const, reason: 'not_found' }
  if (session.discordId !== payload.discordId || session.guildId !== payload.guildId) {
    return { ok: false as const, reason: 'mismatch' }
  }
  if (session.expiresAt.getTime() < Date.now()) {
    if (session.status !== VerificationSessionStatus.COMPLETED) {
      await prisma.discordVerificationSession.update({
        where: { id: session.id },
        data: { status: VerificationSessionStatus.EXPIRED },
      })
    }
    return { ok: false as const, reason: 'expired' }
  }

  return { ok: true as const, payload, session }
}

export async function writeVerificationAudit(input: {
  sessionId?: string
  discordId: string
  action: string
  flags?: string[]
  details?: Record<string, unknown>
}) {
  await prisma.verificationAuditLog.create({
    data: {
      sessionId: input.sessionId,
      discordId: input.discordId,
      action: input.action,
      flags: input.flags ?? [],
      details: input.details ?? undefined,
    },
  })
}
