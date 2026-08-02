import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getClientIp } from '@/app/lib/ip'

/**
 * POST /api/admin/users/bulk
 * Batch update multiple users (plan, ban, role, etc.)
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  // Re-fetch caller from DB — never trust JWT alone for bulk privileged operations
  // since JWT can be stale if the user's role was changed mid-session
  const callerDb = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId },
    select: { role: true }
  })

  if (!callerDb || callerDb.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const { userIds, action, value } = await request.json()

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: 'No user IDs provided.' }, { status: 400 })
  }

  // Reject non-string IDs to prevent Prisma nested-object injection
  if (!userIds.every((id: unknown) => typeof id === 'string')) {
    return NextResponse.json({ error: 'Invalid user ID format.' }, { status: 400 })
  }

  if (userIds.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 users per batch.' }, { status: 400 })
  }

  try {
    let updateData: any = {}

    let trialWelcomeTargets: { id: string; discordId: string; username: string }[] | null = null

    switch (action) {
      case 'BAN':
        updateData = { isBanned: true }
        break
      case 'UNBAN':
        updateData = { isBanned: false, jailUntil: null, jailLevel: 0 }
        // Fetch users to get their IPs before unbanning
        const usersToUnban = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, lastIp: true }
        })
        const ipsToUnban = usersToUnban
          .map(u => u.lastIp)
          .filter(ip => ip && ip !== 'unknown') as string[]
          
        if (ipsToUnban.length > 0) {
          await (prisma as any).blacklistedIp.deleteMany({
            where: { ip: { in: ipsToUnban } }
          })
          const { refreshBlacklist } = await import('@/app/lib/ratelimit')
          await refreshBlacklist()
        }
        
        // Re-enable API keys for all these users
        await prisma.apiKey.updateMany({
          where: { userId: { in: userIds } },
          data: { enabled: true, adminDisable: false }
        })
        break
      case 'PLAN': {
        const VALID_PLANS = ['FREE', 'REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']
        if (!value || !VALID_PLANS.includes(String(value).toUpperCase())) {
          return NextResponse.json({ error: 'Invalid plan value.' }, { status: 400 })
        }
        updateData = { plan: String(value).toUpperCase() }
        break
      }
      case 'ROLE': {
        const VALID_ROLES = ['USER', 'TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER']
        if (!value || !VALID_ROLES.includes(String(value).toUpperCase())) {
          return NextResponse.json({ error: 'Invalid role value.' }, { status: 400 })
        }
        const safeRole = String(value).toUpperCase()
        updateData =
          safeRole === 'TRIAL_MODERATOR'
            ? { role: safeRole, trialStartDate: new Date(), roleLevel: 25 }
            : { role: safeRole, trialStartDate: null, trialWelcomeDmDeliveredAt: null }
        if (safeRole === 'TRIAL_MODERATOR') {
          const before = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, discordId: true, username: true, role: true },
          })
          trialWelcomeTargets = before
            .filter(u => u.role !== 'TRIAL_MODERATOR')
            .map(u => ({ id: u.id, discordId: u.discordId, username: u.username }))
        }
        break
      }
      case 'CLEAR_RISK':
        updateData = { riskScore: 0, jailLevel: 0, jailUntil: null }
        break
      default:
        return NextResponse.json({ error: 'Invalid bulk action.' }, { status: 400 })
    }

    const { count } = await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: updateData
    })

    if (trialWelcomeTargets?.length) {
      const { sendTrialModeratorWelcomeDm } = await import('@/app/lib/bot-admin')
      for (const u of trialWelcomeTargets) {
        await sendTrialModeratorWelcomeDm(u.discordId, u.username, { userId: u.id })
      }
    }

    // Log the bulk action
    await (prisma as any).auditLog.create({
      data: {
        userId: (session.user as any).id,
        action: `BULK_${action}`,
        details: `Batch update performed on ${count} users with value: ${value || 'N/A'}`,
        ip: getClientIp(request)
      }
    })

    return NextResponse.json({ success: true, count, message: `Successfully updated ${count} users.` })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
