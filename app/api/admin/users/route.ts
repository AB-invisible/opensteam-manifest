import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { sendWebhook } from '@/app/lib/webhooks'
import { getClientIp } from '@/app/lib/ip'

/** Numeric tier for plan comparison. Higher = higher plan. */
const PLAN_TIER: Record<string, number> = {
  FREE: 0, BASIC: 1, STARTER: 1, PRO: 2, PREMIUM: 2, ENTERPRISE: 3, LIFETIME: 4
}
function planTier(p?: string | null): number {
  return PLAN_TIER[(p ?? '').toUpperCase()] ?? 1
}


export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller) {
      return NextResponse.json({ error: 'Caller not found' }, { status: 404, headers })
    }

    // Full user list is OWNER-only — admins can manage individual users via PUT
    if ((caller.role as string) !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden. Owner access required.' }, { status: 403, headers })
    }

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { manifests: true, apiKeys: true }
        }
      }
    })

    return NextResponse.json({ users }, { headers })
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500, headers })
  }
}

export async function PUT(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller) {
      return NextResponse.json({ error: 'Caller not found' }, { status: 404, headers })
    }

    const isAdminOrOwner = (caller.role as any) === 'OWNER';
    if (!isAdminOrOwner) {
      return NextResponse.json({ error: 'Forbidden. Owner access required.' }, { status: 403, headers })
    }

    const { 
      userId, role, plan, planExpiry, 
      customDailyLimit, customMinuteLimit, customAllowMorrenus, customAllowRyuu, 
      isBanned, jailLevel, jailUntil, securityBypass, banReason
    } = await request.json()

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required and must be a string.' }, { status: 400, headers })
    }

    // Strictly allowlist valid role and plan values to prevent DB corruption
    const VALID_ROLES = ['USER', 'TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'HEAD_MODERATOR', 'EXECUTIVE_OFFICER', 'ADMIN', 'OWNER']
    const VALID_PLANS = ['FREE', 'REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']
    if (role && !VALID_ROLES.includes(String(role).toUpperCase())) {
      return NextResponse.json({ error: 'Invalid role value.' }, { status: 400, headers })
    }
    if (plan && !VALID_PLANS.includes(String(plan).toUpperCase())) {
      return NextResponse.json({ error: 'Invalid plan value.' }, { status: 400, headers })
    }

    const safeRole = role ? String(role).toUpperCase() : undefined
    const safePlan = plan ? String(plan).toUpperCase() : undefined

    const userBefore = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, plan: true, isBanned: true, jailUntil: true },
    })

    const updateData: any = {
      ...(safeRole && { 
        role: safeRole,
        roleLevel: safeRole === 'OWNER' ? 150 : safeRole === 'ADMIN' ? 100 : safeRole === 'SENIOR_MODERATOR' ? 75 : safeRole === 'MODERATOR' ? 50 : safeRole === 'TRIAL_MODERATOR' ? 25 : 0,
        // Auto-set trialStartDate when assigning Trial Moderator
        ...(safeRole === 'TRIAL_MODERATOR' ? { trialStartDate: new Date() } : {}),
        // Clear trial fields when promoting/demoting away from trial
        ...(safeRole !== 'TRIAL_MODERATOR' ? { trialStartDate: null, trialWelcomeDmDeliveredAt: null } : {}),
      }),
      ...(safePlan && { plan: safePlan }),
      planExpiry: planExpiry !== undefined ? (planExpiry ? new Date(planExpiry) : null) : undefined,
      isBanned: isBanned !== undefined ? isBanned : undefined,
      customDailyLimit: customDailyLimit !== undefined ? customDailyLimit : undefined,
      customMinuteLimit: customMinuteLimit !== undefined ? customMinuteLimit : undefined,
      customAllowMorrenus: customAllowMorrenus !== undefined ? customAllowMorrenus : undefined,
      customAllowRyuu: customAllowRyuu !== undefined ? customAllowRyuu : undefined,
      jailLevel: jailLevel !== undefined ? jailLevel : undefined,
      jailUntil: jailUntil !== undefined ? (jailUntil ? new Date(jailUntil) : null) : undefined,
      securityBypass: securityBypass !== undefined ? securityBypass : undefined
    }

    await (prisma.user as any).update({
      where: { id: userId },
      data: updateData
    })

    if (isBanned === true) {
      const { banUserGlobally } = await import('@/app/lib/ratelimit')
      await banUserGlobally(userId, banReason || 'Banned by Admin')
    }

    if (jailUntil && new Date(jailUntil) > new Date()) {
      await prisma.apiKey.updateMany({
        where: { userId },
        data: { enabled: false, adminDisable: true }
      });

      const { sendBotDM } = await import('@/app/lib/bot-admin');
      const { sendBrandedEmail } = await import('@/app/lib/email');

      const jailDate = new Date(jailUntil).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (user) {
        if (user.discordId) {
          await sendBotDM(user.discordId, '', {
            title: 'Account Suspended',
            description: `Your OpenSteam account has been temporarily suspended.\n\n**Suspended until:** ${jailDate}\n\nYour API keys have been disabled for the duration of this suspension.`,
            color: 0xf97316,
            footer: { text: 'OpenSteam' }
          }).catch(() => {});
        }
        if (user.email) {
          await sendBrandedEmail(
            user.email,
            'Your OpenSteam account has been suspended',
            'Account Suspended',
            `Your account has been temporarily suspended until <strong>${jailDate}</strong>. During this period, your API keys are disabled.<br><br>Access is restored automatically once the suspension expires. If you have questions, please contact support.`,
            '#f97316',
            undefined,
            { buttonText: 'Contact Support', buttonUrl: 'http://127.0.0.1:3000/support' }
          ).catch(() => {});
        }
      }
    }

    // Recovery Check (Unbanned or Unsuspended)
    if (
      (userBefore?.isBanned && isBanned === false) ||
      (userBefore?.jailUntil && new Date(userBefore.jailUntil) > new Date() && (jailUntil === null || (jailUntil && new Date(jailUntil) <= new Date())))
    ) {
      // Re-enable their API keys, lift IP blacklist, reset DB ban states
      const { unbanUserGlobally } = await import('@/app/lib/ratelimit');
      await unbanUserGlobally(userId);

      const { sendBotDM } = await import('@/app/lib/bot-admin');
      const { sendBrandedEmail } = await import('@/app/lib/email');

      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (user) {
        if (user.discordId) {
          await sendBotDM(user.discordId, '', {
            title: 'Account Access Restored',
            description: 'Your OpenSteam account restrictions have been lifted and your API keys have been re-enabled.',
            color: 0x16a34a,
            footer: { text: 'OpenSteam' }
          }).catch(() => {});
        }
        if (user.email) {
          await sendBrandedEmail(
            user.email,
            'Your OpenSteam account has been restored',
            'Account Access Restored',
            'Your account restrictions have been lifted. API access has been re-enabled and your previous configuration is active.',
            '#16a34a',
            undefined,
            { buttonText: 'Go to Dashboard', buttonUrl: 'http://127.0.0.1:3000/dashboard' }
          ).catch(() => {});
        }
      }
    }
    
    const updatedUser = await prisma.user.findUnique({ where: { id: userId } })
    if (!updatedUser) return NextResponse.json({ error: 'User not found' }, { status: 404, headers })

    if (
      role === 'TRIAL_MODERATOR' &&
      userBefore?.role !== 'TRIAL_MODERATOR' &&
      updatedUser.role === 'TRIAL_MODERATOR'
    ) {
      const { sendTrialModeratorWelcomeDm } = await import('@/app/lib/bot-admin')
      await sendTrialModeratorWelcomeDm(updatedUser.discordId, updatedUser.username, { userId: updatedUser.id })
    }

    // If plan changed or banned, trigger webhook and audit log
    if (plan || role || isBanned !== undefined) {
      const details = isBanned === true
        ? `Banned: true. Reason: ${banReason || 'Banned by Admin'}`
        : `Plan: ${updatedUser.plan}, Role: ${updatedUser.role}, Banned: ${(updatedUser as any).isBanned}`
      
      if (plan && plan !== userBefore?.plan) {
        const { upsertHostedBotInstanceForUser, suspendHostedBotInstance } = await import('@/app/lib/hosted-bot')
        const { getHostedBotTypeForPlan } = await import('@/app/lib/hosted-bot-plans')
        if (getHostedBotTypeForPlan(updatedUser.plan as any)) {
          await upsertHostedBotInstanceForUser(updatedUser.id, updatedUser.plan as any).catch((err) =>
            console.error('[Admin User Update] Hosted bot upsert failed:', err)
          )
        } else {
          await suspendHostedBotInstance(updatedUser.id, true).catch((err) =>
            console.error('[Admin User Update] Hosted bot suspend failed:', err)
          )
        }

        const { notifyPlanUpgrade, notifyPlanDowngrade } = await import('@/app/lib/email');
        const isDowngrade = planTier(plan) < planTier(userBefore?.plan);

        if (isDowngrade) {
          await notifyPlanDowngrade(updatedUser.id, plan);
        } else {
          await notifyPlanUpgrade(updatedUser.id, plan, updatedUser.planExpiry);
        }
      }

      // Generic Account Configuration Update (Role or Custom Quotas)
      if (
        (role && role !== userBefore?.role) ||
        customDailyLimit !== undefined ||
        customMinuteLimit !== undefined
      ) {
        const { sendBotDM } = await import('@/app/lib/bot-admin');
        const { sendBrandedEmail } = await import('@/app/lib/email');

        let changeDetails = '';
        if (role && role !== userBefore?.role) changeDetails += `• Role updated to **${role}**\n`;
        if (customDailyLimit !== undefined) changeDetails += `• Daily limit updated to **${customDailyLimit}**\n`;
        if (customMinuteLimit !== undefined) changeDetails += `• Burst limit updated to **${customMinuteLimit}**\n`;

        if (updatedUser.discordId) {
          await sendBotDM(updatedUser.discordId, '', {
            title: 'Account Updated',
            description: `An administrator has updated your account:\n\n${changeDetails}`,
            color: 0x6366f1,
            footer: { text: 'OpenSteam' }
          }).catch(() => {});
        }

        if (updatedUser.email) {
          await sendBrandedEmail(
            updatedUser.email,
            'Your OpenSteam account has been updated',
            'Account Updated',
            `An administrator has made the following changes to your account:<br><br>${changeDetails.replace(/\n/g, '<br>')}<br>These changes are effective immediately.`,
            '#6366f1',
            undefined,
            { buttonText: 'Go to Dashboard', buttonUrl: 'http://127.0.0.1:3000/dashboard' }
          ).catch(() => {});
        }
      }

      sendWebhook('ADMIN_ACTION', {
        action: isBanned ? 'USER_BANNED' : 'USER_UPDATED',
        username: updatedUser.username,
        userId: updatedUser.id,
        details
      })

      const { createAuditLog } = await import('@/app/lib/audit')
      const ip = getClientIp(request)
      await createAuditLog(
        caller.id, 
        isBanned ? 'BAN_USER' : 'UPDATE_USER', 
        updatedUser.id, 
        details, 
        ip
      )
    }

    return NextResponse.json({ success: true, user: updatedUser }, { headers })
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500, headers })
  }
}
