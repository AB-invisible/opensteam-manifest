import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { createOrganization } from '@/app/lib/org';

/**
 * GET /api/orgs
 * List organizations the user belongs to, or fetch details for a specific org.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');

  const userRecord = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const userId = userRecord.id;

  try {
    // Fetch specific org details + members
    if (orgId) {
      // 1. If Admin, bypass membership check and fetch org directly
      const role = (session.user as any).role;
      if (role === 'ADMIN' || role === 'OWNER') {
        const org = await (prisma as any).organization.findUnique({
          where: { id: orgId },
          include: {
            members: {
              include: { user: { select: { username: true, discordId: true, avatar: true, plan: true } } }
            },
            _count: { select: { members: true, apiKeys: true } }
          }
        });
        return NextResponse.json({ org });
      }

      // 2. Otherwise, verify membership
      const membership = await (prisma as any).orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: {
          organization: {
            include: {
              members: {
                include: { user: { select: { username: true, discordId: true, avatar: true, plan: true } } }
              },
              _count: { select: { members: true, apiKeys: true } }
            }
          }
        }
      });

      if (!membership) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      return NextResponse.json({ org: membership.organization });
    }

    // Handle separate query for pending invitations
    const invitesOnly = searchParams.get('invites') === 'true';

    const memberships = await (prisma as any).orgMembership.findMany({
      where: { 
        userId,
        status: invitesOnly ? 'PENDING' : 'ACCEPTED'
      },
      include: {
        organization: {
          include: {
            owner: { select: { username: true } },
            _count: {
              select: { members: true, apiKeys: true }
            }
          }
        }
      }
    });

    const orgs = memberships.map((m: any) => ({
      ...m.organization,
      userRole: m.role,
      status: m.status
    }));

    return NextResponse.json({ orgs });
  } catch (error) {
    console.error('Fetch orgs error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/**
 * POST /api/orgs
 * Create a new team organization.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRecord = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Plan requirement: Only BUSINESS, CUSTOM, or ADMIN can create organizations
  if (userRecord.plan !== 'BUSINESS' && userRecord.plan !== 'CUSTOM' && userRecord.role !== 'ADMIN' && userRecord.role !== 'OWNER') {
    return NextResponse.json({ error: 'Access denied. Business plan required to create teams.' }, { status: 403 });
  }

  try {
    const { name } = await req.json();
    if (!name) return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });

    const userId = userRecord.id; // Use verified DB CUID
    const org = await createOrganization(name, userId);

    return NextResponse.json({ org });
  } catch (error) {
    console.error('Create org error:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}

/**
 * DELETE /api/orgs
 * Delete an organization (owner or admin only)
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { orgId } = await req.json();
    if (!orgId) return NextResponse.json({ error: 'Missing organization ID' }, { status: 400 });

    const userRecord = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    });
    if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const org = await (prisma as any).organization.findUnique({
      where: { id: orgId },
      include: {
        members: true
      }
    });

    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const isOwner = org.ownerId === userRecord.id;
    const isAdmin = userRecord.role === 'ADMIN' || userRecord.role === 'OWNER';

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Access denied. Only the organization owner can delete it.' }, { status: 403 });
    }

    await (prisma as any).organization.delete({
      where: { id: orgId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete org error:', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
