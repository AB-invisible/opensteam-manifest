import { authOptions } from '@/app/lib/auth-options'
import { LEGACY_EXAM_KIND } from '@/app/lib/mod-assessment-service'
import { graduateTrialModDiscordRoles, logDiscordModRoleResult } from '@/app/lib/discord-mod-roles'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/trial/test
 * Get a trial mod's active test (for the trial mod themselves to take)
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Trial mods can view their own test, admins can view any
  const isStaff = user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'SENIOR_MODERATOR'
  const targetUserId = isStaff ? (request.nextUrl.searchParams.get('userId') || user.id) : user.id

  const test = await prisma.trialTest.findFirst({
    where: {
      userId: targetUserId,
      examKind: LEGACY_EXAM_KIND,
      status: {
        in: [
          'ACTIVE',
          'SUBMITTED',
          'AWAITING_STAFF',
          'PASSED',
          'FAILED',
          'APPEALED',
          'OVERRIDE_PASS',
          'OVERRIDE_FAIL',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, username: true, avatar: true, discordId: true }
      }
    }
  })

  if (!test) {
    return NextResponse.json({ test: null })
  }

  // Strip correct answers if the test is still ACTIVE and the viewer is the test taker
  const isTestTaker = user.id === test.userId
  const questions = (test.questions as any[]).map((q: any) => {
    if (isTestTaker && test.status === 'ACTIVE') {
      if (q?.type === 'mcq' && q.correct) {
        const { correct, ...rest } = q
        return rest
      }
      if (q?.type === 'fill' && q.rubricForAi) {
        const { rubricForAi, ...rest } = q
        return rest
      }
      if (q?.correctIndex !== undefined) {
        const { correctIndex, ...rest } = q
        return rest
      }
    }
    return q
  })

  return NextResponse.json({
    test: {
      ...test,
      questions,
    }
  })
}

/**
 * POST /api/admin/trial/test
 * Submit test answers (trial mod) or appeal (trial mod)
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { action, testId, answers } = await request.json()

  if (action === 'submit') {
    // Trial mod submitting their test answers
    if (user.role !== 'TRIAL_MODERATOR') {
      return NextResponse.json({ error: 'Only Trial Moderators can submit tests' }, { status: 403 })
    }

    const test = await prisma.trialTest.findFirst({
      where: {
        id: testId,
        userId: user.id,
        status: 'ACTIVE',
        examKind: LEGACY_EXAM_KIND,
      },
    })

    if (!test) {
      return NextResponse.json({ error: 'No active test found' }, { status: 404 })
    }

    // Check if expired
    if (test.expiresAt && new Date() > test.expiresAt) {
      await prisma.trialTest.update({
        where: { id: testId },
        data: { status: 'FAILED', feedback: 'Test expired before submission.', gradedAt: new Date() }
      })
      return NextResponse.json({ error: 'Test has expired' }, { status: 400 })
    }

    // Auto-grade
    const questions = test.questions as any[]
    let correctCount = 0

    for (let i = 0; i < questions.length; i++) {
      if (answers[i] === questions[i].correctIndex) {
        correctCount++
      }
    }

    const score = correctCount
    const passed = score >= test.passingScore
    const percentage = Math.round((score / test.maxScore) * 100)

    const feedback = passed
      ? `Congratulations! You scored ${score}/${test.maxScore} (${percentage}%). You have passed the trial moderator evaluation.`
      : `You scored ${score}/${test.maxScore} (${percentage}%). The passing score is ${test.passingScore}/${test.maxScore} (${Math.round((test.passingScore / test.maxScore) * 100)}%). You may appeal this result to an Admin.`

    await prisma.trialTest.update({
      where: { id: testId },
      data: {
        answers: answers,
        score,
        status: passed ? 'PASSED' : 'FAILED',
        feedback,
        submittedAt: new Date(),
        gradedAt: new Date(),
      }
    })

    // If passed, auto-promote to full Moderator
    if (passed) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: 'MODERATOR', roleLevel: 50, trialStartDate: null, trialWelcomeDmDeliveredAt: null }
      })

      if (user.discordId) {
        void graduateTrialModDiscordRoles(user.discordId).then((result) =>
          logDiscordModRoleResult('legacy_trial_test_pass', user.discordId, result)
        )
      }
    } else {
      // If failed, auto-demote back to Member
      await prisma.user.update({
        where: { id: user.id },
        data: { role: 'USER', roleLevel: 0, trialStartDate: null, trialWelcomeDmDeliveredAt: null }
      })
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: passed ? 'TRIAL_TEST_PASSED' : 'TRIAL_TEST_FAILED',
        targetId: testId,
        details: `Trial test ${passed ? 'passed' : 'failed'}: ${score}/${test.maxScore} (${percentage}%). ${passed ? 'Auto-promoted to Moderator.' : 'Auto-demoted to Member.'}`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true, score, maxScore: test.maxScore, passed, feedback })
  }

  if (action === 'appeal') {
    // Trial mod appealing a failed test
    const test = await prisma.trialTest.findFirst({
      where: { id: testId, userId: user.id, status: 'FAILED', examKind: LEGACY_EXAM_KIND },
    })

    if (!test) {
      return NextResponse.json({ error: 'No failed test found to appeal' }, { status: 404 })
    }

    await prisma.trialTest.update({
      where: { id: testId },
      data: { status: 'APPEALED' }
    })

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'TRIAL_TEST_APPEAL',
        targetId: testId,
        details: `Trial Moderator appealed failed test result`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true, message: 'Appeal submitted. An Admin will review your test.' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
