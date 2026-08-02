import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { verifyDiscordBotRequest } from '@/app/lib/discord-bot-auth'
import { computeVerifyFunnel } from '@/app/lib/verify-funnel'
import { writeVerificationAudit } from '@/app/lib/discord-verify-session'
import { sendBotDM } from '@/app/lib/bot-admin'
import { getPublicAppUrl } from '@/app/lib/public-app-url'
import {
  getVerificationAltReviewState,
  mergeVerificationAltReviewState,
} from '@/app/lib/verification-alt-policy'
import { VerificationSessionStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId },
  })
  if (!user || !['ADMIN', 'OWNER'].includes(user.role)) return null
  return user
}

function isPendingAltReview(riskFlags: unknown): boolean {
  const review = getVerificationAltReviewState(riskFlags)
  return review?.status === 'pending'
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [audits, sessions, funnel24h, funnel1h] = await Promise.all([
    prisma.verificationAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.discordVerificationSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        discordId: true,
        status: true,
        vpnDetected: true,
        altMatchedUserIds: true,
        verifyIp: true,
        verifyCountry: true,
        completedAt: true,
        createdAt: true,
        riskFlags: true,
        discordIntelSnapshot: true,
      },
    }),
    computeVerifyFunnel(24),
    computeVerifyFunnel(1),
  ])

  const discordIds = [...new Set(sessions.map((s) => s.discordId))]
  const users = await prisma.user.findMany({
    where: { discordId: { in: discordIds } },
    select: {
      discordId: true,
      username: true,
      discordGlobalName: true,
      email: true,
      discordLocale: true,
      discordPremiumType: true,
      discordMfaEnabled: true,
      discordEmailVerified: true,
      discordProfileSnapshot: true,
    },
  })
  const userByDiscord = new Map(users.map((u) => [u.discordId, u]))

  const enrichedSessions = sessions.map((s) => ({
    ...s,
    user: userByDiscord.get(s.discordId) ?? null,
    altReview: getVerificationAltReviewState(s.riskFlags),
  }))

  const pendingAltReviews = enrichedSessions.filter(
    (session) => isPendingAltReview(session.riskFlags) && session.status === VerificationSessionStatus.OAUTH_COMPLETE,
  )

  return NextResponse.json({
    audits,
    sessions: enrichedSessions,
    pendingAltReviews,
    funnel: { last24h: funnel24h, last1h: funnel1h },
  })
}

/** Clear stored verify message ID so bot reposts on next startup or via bot hook */
export async function POST(request: NextRequest) {
  const isBot = await verifyDiscordBotRequest(request)
  const user = isBot ? null : await requireAdmin()
  if (!isBot && !user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))

  if (body.action === 'clear_verify_message') {
    await prisma.systemConfig.upsert({
      where: { key: 'DISCORD_VERIFY_MESSAGE_ID' },
      update: { value: '' },
      create: { key: 'DISCORD_VERIFY_MESSAGE_ID', value: '', isSecret: false },
    })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'review_alt') {
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sessionId = String(body.sessionId || '').trim()
    const decision = String(body.decision || '').trim().toLowerCase()
    const notes = body.notes ? String(body.notes).trim() : ''

    if (!sessionId || !['approve', 'reject'].includes(decision)) {
      return NextResponse.json({ error: 'sessionId and decision (approve|reject) are required' }, { status: 400 })
    }

    const session = await prisma.discordVerificationSession.findUnique({ where: { id: sessionId } })
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const currentReview = getVerificationAltReviewState(session.riskFlags)
    if (currentReview?.status !== 'pending') {
      return NextResponse.json({ error: 'No pending alt review for this session' }, { status: 400 })
    }

    const reviewedAt = new Date().toISOString()
    const nextReview = {
      ...currentReview,
      status: decision === 'approve' ? ('approved' as const) : ('rejected' as const),
      reviewedAt,
      reviewedBy: user.username,
      notes: notes || undefined,
    }

    await prisma.discordVerificationSession.update({
      where: { id: sessionId },
      data: {
        status:
          decision === 'reject'
            ? VerificationSessionStatus.FAILED
            : VerificationSessionStatus.OAUTH_COMPLETE,
        riskFlags: mergeVerificationAltReviewState(session.riskFlags, nextReview),
      },
    })

    await writeVerificationAudit({
      sessionId,
      discordId: session.discordId,
      action: decision === 'approve' ? 'ALT_REVIEW_APPROVED' : 'ALT_REVIEW_REJECTED',
      flags: currentReview.blockedFlags || [],
      details: {
        reviewedBy: user.username,
        notes: notes || null,
        matchedFlags: currentReview.matchedFlags || [],
      },
    })

    const baseUrl = getPublicAppUrl() || 'http://127.0.0.1:3000'
    if (decision === 'approve') {
      void sendBotDM(session.discordId, '', {
        title: '✅ Alt verification approved',
        description: [
          'Staff approved your OpenSteam verification after an alt-account review.',
          '',
          'Return to your verification page and click **Complete verification** again.',
          `If the tab closed, use the **Verify** button in Discord to reopen your link.`,
        ].join('\n'),
        color: 0x10b981,
        footer: { text: 'OpenSteam Verification' },
        timestamp: reviewedAt,
      }).catch((err) => console.error('[Verify] alt approval DM failed:', err))
    } else {
      void sendBotDM(session.discordId, '', {
        title: '❌ Alt verification rejected',
        description: [
          'Staff reviewed your OpenSteam verification and did not approve the alt-account match.',
          '',
          'If you believe this was a mistake, contact moderation in Discord.',
          `Support: ${baseUrl}/discord`,
        ].join('\n'),
        color: 0xef4444,
        footer: { text: 'OpenSteam Verification' },
        timestamp: reviewedAt,
      }).catch((err) => console.error('[Verify] alt rejection DM failed:', err))
    }

    return NextResponse.json({ success: true, review: nextReview })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
