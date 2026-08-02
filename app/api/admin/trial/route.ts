import { authOptions } from '@/app/lib/auth-options'
import { LEGACY_EXAM_KIND } from '@/app/lib/mod-assessment-service'
import { graduateTrialModDiscordRoles, logDiscordModRoleResult } from '@/app/lib/discord-mod-roles'
import { prisma } from '@/app/lib/prisma'
import { TRIAL_MOD_DAYS, msForTrialModDays } from '@/app/lib/moderator-trial'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/trial
 * List all trial moderators and their test status
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER' && user.role !== 'SENIOR_MODERATOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const trialMods = await prisma.user.findMany({
    where: { role: 'TRIAL_MODERATOR' },
    select: {
      id: true,
      discordId: true,
      username: true,
      avatar: true,
      trialStartDate: true,
      trialModEndsAt: true,
      modTestReadyAt: true,
      trialWelcomeDmDeliveredAt: true,
      createdAt: true,
      trialTests: {
        where: { examKind: LEGACY_EXAM_KIND },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          score: true,
          maxScore: true,
          generatedAt: true,
          submittedAt: true,
          gradedAt: true,
          feedback: true,
          adminNotes: true,
        }
      }
    },
    orderBy: { trialStartDate: 'asc' }
  })

  // Calculate days remaining for each trial mod
  const enriched = trialMods.map(mod => {
    const fallbackStart = mod.trialStartDate ? new Date(mod.trialStartDate) : new Date(mod.createdAt)
    const trialEndDate = mod.trialModEndsAt
      ? new Date(mod.trialModEndsAt)
      : new Date(fallbackStart.getTime() + msForTrialModDays(TRIAL_MOD_DAYS))
    const daysRemaining = Math.max(
      0,
      Math.ceil((trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    )
    const isExpired = daysRemaining === 0
    const latestTest = mod.trialTests[0] || null

    return {
      ...mod,
      trialEndDate: trialEndDate.toISOString(),
      daysRemaining,
      isExpired,
      latestTest,
      trialTests: undefined // Remove array, we only return latestTest
    }
  })

  return NextResponse.json({ trialMods: enriched })
}

/**
 * POST /api/admin/trial
 * Promote a user to TRIAL_MODERATOR, or override test results
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'OWNER' && admin.role !== 'SENIOR_MODERATOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { action, userId, testId, notes } = await request.json()

  if (action === 'promote_trial') {
    const targetBefore = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, discordId: true, username: true },
    })

    await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'TRIAL_MODERATOR',
        roleLevel: 25,
        trialStartDate: new Date(),
      }
    })

    const promoted = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true, username: true, role: true },
    })

    if (promoted && targetBefore?.role !== 'TRIAL_MODERATOR') {
      const { sendTrialModeratorWelcomeDm } = await import('@/app/lib/bot-admin')
      await sendTrialModeratorWelcomeDm(promoted.discordId, promoted.username, { userId })
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'PROMOTE_TRIAL_MOD',
        targetId: userId,
        details: `Promoted user to Trial Moderator`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true })
  }

  if (action === 'resend_trial_welcome_dms') {
    const mods = await prisma.user.findMany({
      where: { role: 'TRIAL_MODERATOR' },
      select: { id: true, discordId: true, username: true },
    })
    const { sendTrialModeratorWelcomeDm } = await import('@/app/lib/bot-admin')
    const delivered: { id: string; username: string }[] = []
    const failed: { id: string; username: string; reason: string }[] = []
    for (const m of mods) {
      if (!m.discordId?.trim()) {
        failed.push({ id: m.id, username: m.username, reason: 'Missing Discord id' })
        continue
      }
      const ok = await sendTrialModeratorWelcomeDm(m.discordId, m.username, { userId: m.id })
      if (ok) delivered.push({ id: m.id, username: m.username })
      else failed.push({ id: m.id, username: m.username, reason: 'Discord API or bot token' })
    }
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'RESEND_TRIAL_WELCOME_DMS',
        details: `Resent trial welcome DMs: ${delivered.length} ok, ${failed.length} failed`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1',
      },
    })
    return NextResponse.json({ success: true, delivered, failed, counts: { delivered: delivered.length, failed: failed.length, total: mods.length } })
  }

  if (action === 'promote_full') {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true },
    })

    // Graduate trial mod to full moderator
    await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'MODERATOR',
        trialStartDate: null,
        trialWelcomeDmDeliveredAt: null,
      }
    })

    if (target?.discordId) {
      void graduateTrialModDiscordRoles(target.discordId).then((result) =>
        logDiscordModRoleResult('promote_full', target.discordId, result)
      )
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'PROMOTE_MODERATOR',
        targetId: userId,
        details: `Graduated Trial Moderator to full Moderator`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true })
  }

  if (action === 'override_pass' || action === 'override_fail') {
    if (!testId) {
      return NextResponse.json({ error: 'testId required for override' }, { status: 400 })
    }

    const row = await prisma.trialTest.findUnique({
      where: { id: testId },
      select: { examKind: true },
    })
    if (!row || row.examKind !== LEGACY_EXAM_KIND) {
      return NextResponse.json(
        { error: 'Overrides apply to handbook MCQ trials only — use moderator assessment tools for live exams.' },
        { status: 400 },
      )
    }

    const newStatus = action === 'override_pass' ? 'OVERRIDE_PASS' : 'OVERRIDE_FAIL'
    
    await prisma.trialTest.update({
      where: { id: testId },
      data: {
        status: newStatus as any,
        adminNotes: notes || null,
        adminId: admin.id,
        gradedAt: new Date(),
      }
    })

    // If overriding to pass, promote to full moderator
    if (action === 'override_pass') {
      const test = await prisma.trialTest.findUnique({
        where: { id: testId },
        include: { user: { select: { discordId: true } } },
      })
      if (test) {
        await prisma.user.update({
          where: { id: test.userId },
          data: { role: 'MODERATOR', roleLevel: 50, trialStartDate: null, trialWelcomeDmDeliveredAt: null }
        })

        if (test.user?.discordId) {
          void graduateTrialModDiscordRoles(test.user.discordId).then((result) =>
            logDiscordModRoleResult('override_pass', test.user!.discordId, result)
          )
        }
      }
    }

    // If overriding to fail, demote back to Member
    if (action === 'override_fail') {
      const test = await prisma.trialTest.findUnique({ where: { id: testId } })
      if (test) {
        await prisma.user.update({
          where: { id: test.userId },
          data: { role: 'USER', roleLevel: 0, trialStartDate: null, trialWelcomeDmDeliveredAt: null }
        })
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: action === 'override_pass' ? 'TRIAL_OVERRIDE_PASS' : 'TRIAL_OVERRIDE_FAIL',
        targetId: testId,
        details: `Admin ${action === 'override_pass' ? 'passed' : 'failed'} trial test override. Notes: ${notes || 'None'}`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true })
  }

  if (action === 'demote') {
    await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'USER',
        trialStartDate: null,
        trialWelcomeDmDeliveredAt: null,
      }
    })

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'DEMOTE_TRIAL_MOD',
        targetId: userId,
        details: `Demoted Trial Moderator back to User`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
