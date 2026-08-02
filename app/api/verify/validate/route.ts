import { NextRequest, NextResponse } from 'next/server'
import { loadVerificationSession, writeVerificationAudit } from '@/app/lib/discord-verify-session'
import { prisma } from '@/app/lib/prisma'
import { checkVerifyFailureSpike } from '@/app/lib/verify-funnel'
import { getVerificationAltReviewState } from '@/app/lib/verification-alt-policy'
import { VerificationSessionStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const s = request.nextUrl.searchParams.get('s')
  if (!s) {
    return NextResponse.json({ valid: false, reason: 'missing_session' })
  }

  const loaded = await loadVerificationSession(s)
  if (!loaded.ok) {
    if (loaded.reason !== 'invalid_or_expired') {
      const payload = parseSignedDiscordId(s)
      if (payload) {
        await writeVerificationAudit({
          discordId: payload,
          action: 'SESSION_VALIDATED_FAIL',
          details: { reason: loaded.reason },
        }).catch(() => {})
        void checkVerifyFailureSpike()
      }
    }
    return NextResponse.json({ valid: false, reason: loaded.reason })
  }

  const { session } = loaded

  await writeVerificationAudit({
    sessionId: session.id,
    discordId: session.discordId,
    action: 'SESSION_VALIDATED',
    details: { status: session.status },
  }).catch(() => {})

  const user = await prisma.user.findUnique({
    where: { discordId: session.discordId },
    select: { webSessionRevokedAt: true },
  })

  const altReview = getVerificationAltReviewState(session.riskFlags)

  return NextResponse.json({
    valid: true,
    status: session.status,
    oauthComplete: session.status === VerificationSessionStatus.OAUTH_COMPLETE,
    completed: session.status === VerificationSessionStatus.COMPLETED,
    discordId: session.discordId,
    expiresAt: session.expiresAt.toISOString(),
    needsRenewal: !!user?.webSessionRevokedAt,
    altReviewPending: altReview?.status === 'pending',
    altReviewStatus: altReview?.status || null,
    altApproved: altReview?.status === 'approved',
  })
}

function parseSignedDiscordId(s: string): string | null {
  try {
    const [encoded] = s.split('.')
    if (!encoded) return null
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return typeof parsed.discordId === 'string' ? parsed.discordId : null
  } catch {
    return null
  }
}
