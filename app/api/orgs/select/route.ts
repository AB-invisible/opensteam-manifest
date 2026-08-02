import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';

/**
 * POST /api/orgs/select
 * Set the user's active organization context.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { orgId } = await req.json();
    if (!orgId) return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });

    const discordId = (session.user as any).discordId;

    // 1. Verify membership
    const membership = await (prisma as any).orgMembership.findUnique({
      where: {
        userId_orgId: {
          userId: (session.user as any).id,
          orgId
        }
      }
    });

    const role = (session.user as any).role;
    if (!membership && role !== 'ADMIN' && role !== 'OWNER') {
      return NextResponse.json({ error: 'Access denied. You are not a member of this organization.' }, { status: 403 });
    }

    // 2. Update user's activeOrgId
    await prisma.user.update({
      where: { discordId },
      data: { activeOrgId: orgId }
    });

    return NextResponse.json({ success: true, activeOrgId: orgId });
  } catch (error) {
    console.error('Org selection error:', error);
    return NextResponse.json({ error: 'Failed to select organization' }, { status: 500 });
  }
}
