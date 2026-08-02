import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { OrgRole } from '@prisma/client';
import { normalizeInvitedOrgRole } from '@/app/lib/org-roles';

/**
 * POST /api/orgs/members
 * Invite a member to an organization.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { orgId, discordId, role } = await req.json();
    if (!orgId || !discordId) {
      return NextResponse.json({ error: 'Organization ID and Discord ID are required' }, { status: 400 });
    }

    // 1. Verify requester is OWNER or ADMIN (Site-wide Role)
    const requesterMembership = await (prisma as any).orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: (session.user as any).id,
          orgId
        }
      }
    });

    const siteRole = (session.user as any).role;
    if (!requesterMembership || (requesterMembership.role !== OrgRole.OWNER && siteRole !== 'ADMIN' && siteRole !== 'OWNER')) {
      return NextResponse.json({ error: 'Access denied. Only owners can manage members.' }, { status: 403 });
    }

    // 2. Resolve target user by discordId
    const targetUser = await prisma.user.findUnique({
      where: { discordId }
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found. They must login to OpenSteam once first.' }, { status: 404 });
    }

    // 3. Quota Check
    const currentMemberships = await (prisma as any).orgMembership.findMany({
      where: { orgId, status: 'ACCEPTED' },
      include: { user: { select: { plan: true } } }
    });

    const proPlans = ['BUSINESS', 'CUSTOM'];
    const proMemberCount = currentMemberships.filter((m: any) => proPlans.includes(m.user.plan)).length;
    const nonProMemberCount = currentMemberships.filter((m: any) => !proPlans.includes(m.user.plan)).length;

    const isInvitePro = proPlans.includes(targetUser.plan);

    if (isInvitePro && proMemberCount >= 5) {
      return NextResponse.json({ error: 'Professional member quota exceeded (Max 5).' }, { status: 400 });
    }
    if (!isInvitePro && nonProMemberCount >= 1) {
      return NextResponse.json({ error: 'Non-Professional member quota exceeded (Max 1).' }, { status: 400 });
    }

    // 4. Create membership with PENDING status
    await (prisma as any).orgMembership.create({
      data: {
        userId: targetUser.id,
        orgId,
        role: normalizeInvitedOrgRole(role),
        status: 'PENDING'
      }
    });

    return NextResponse.json({ success: true, user: { username: targetUser.username }, status: 'PENDING' });
  } catch (error) {
    if ((error as any).code === 'P2002') {
      return NextResponse.json({ error: 'User is already a member of this organization.' }, { status: 400 });
    }
    console.error('Add member error:', error);
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 });
  }
}

/**
 * DELETE /api/orgs/members
 * Remove a member from an organization.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { orgId, userId } = await req.json();
    if (!orgId || !userId) {
      return NextResponse.json({ error: 'Organization ID and User ID are required' }, { status: 400 });
    }

    // 1. Verify requester permission
    const siteRole = (session.user as any).role;
    const isSelf = userId === (session.user as any).id;
    const requesterMembership = await (prisma as any).orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: (session.user as any).id,
          orgId
        }
      }
    });

    const isAuthorized = 
      isSelf || 
      (requesterMembership?.role === OrgRole.OWNER) || 
      (siteRole === 'ADMIN' || siteRole === 'OWNER');

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Access denied. You can only remove yourself or be an owner/admin.' }, { status: 403 });
    }

    // 2. Cannot remove the owner
    const targetMembership = await (prisma as any).orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } }
    });

    if (targetMembership?.role === OrgRole.OWNER) {
      return NextResponse.json({ error: 'Cannot remove the organization owner.' }, { status: 400 });
    }

    // 3. Delete membership
    await (prisma as any).orgMembership.delete({
      where: { userId_orgId: { userId, orgId } }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
