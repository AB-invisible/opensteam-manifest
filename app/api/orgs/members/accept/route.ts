import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { MembershipStatus } from '@prisma/client';

/**
 * POST /api/orgs/members/accept
 * Accept a pending organization invitation.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { orgId } = await req.json();
    if (!orgId) return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });

    const userId = (session.user as any).id;

    // 1. Verify membership exists and is PENDING
    const membership = await (prisma as any).orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } }
    });

    if (!membership) {
      return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
    }

    if (membership.status !== 'PENDING') {
      return NextResponse.json({ error: 'Invitation has already been processed.' }, { status: 400 });
    }

    // 2. Perform Quota Check (Again, in case it changed since invite)
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const currentMemberships = await (prisma as any).orgMembership.findMany({
      where: { orgId, status: 'ACCEPTED' },
      include: { user: { select: { plan: true } } }
    });

    const proPlans = ['BUSINESS', 'CUSTOM'];
    const proMemberCount = currentMemberships.filter((m: any) => proPlans.includes(m.user.plan)).length;
    const nonProMemberCount = currentMemberships.filter((m: any) => !proPlans.includes(m.user.plan)).length;

    const isUserPro = proPlans.includes(targetUser.plan);

    if (isUserPro && proMemberCount >= 5) {
      return NextResponse.json({ error: 'Organization professional member quota is full.' }, { status: 400 });
    }
    if (!isUserPro && nonProMemberCount >= 1) {
      return NextResponse.json({ error: 'Organization non-professional member quota is full.' }, { status: 400 });
    }

    // 3. Accept invitation
    await (prisma as any).orgMembership.update({
      where: { userId_orgId: { userId, orgId } },
      data: { status: 'ACCEPTED' }
    });

    // 4. Set as activeOrgId if they don't have one
    if (!targetUser.activeOrgId) {
      await prisma.user.update({
        where: { id: userId },
        data: { activeOrgId: orgId }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Accept invite error:', error);
    return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 });
  }
}
