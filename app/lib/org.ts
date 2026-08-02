import { prisma } from './prisma';
import { Plan, OrgRole } from '@prisma/client';

/**
 * Create a new organization and assign the creator as the OWNER.
 */
export async function createOrganization(name: string, userId: string, plan: Plan = Plan.FREE) {
  return await prisma.$transaction(async (tx) => {
    // 1. Create the organization
    const org = await (tx as any).organization.create({
      data: {
        name,
        plan,
        creatorId: userId,
      }
    });

    // 2. Create the OWNER membership
    await (tx as any).orgMembership.create({
      data: {
        userId,
        orgId: org.id,
        role: OrgRole.OWNER,
      }
    });

    // 3. Set as active organization for the user
    await (tx as any).user.update({
      where: { id: userId },
      data: { activeOrgId: org.id }
    });

    return org;
  });
}

/**
 * Add a member to an organization.
 */
export async function addOrgMember(orgId: string, userId: string, role: OrgRole = OrgRole.MEMBER) {
  return await (prisma as any).orgMembership.create({
    data: {
      userId,
      orgId,
      role,
    }
  });
}

/**
 * Check if a user has a specific role in an organization.
 */
export async function hasOrgRole(userId: string, orgId: string, roles: OrgRole[]) {
  const membership = await (prisma as any).orgMembership.findUnique({
    where: {
      userId_orgId: { userId, orgId }
    }
  });

  return membership && roles.includes(membership.role);
}

/**
 * Get organization shared quotas based on its plan.
 */
export async function getOrgQuotas(orgId: string) {
  const org = await (prisma as any).organization.findUnique({
    where: { id: orgId },
    select: { plan: true }
  });

  if (!org) return null;

  // Plan-based limits (Mirroring individual plans for now, can be scaled)
  const limits: Record<Plan, { daily: number; minute: number }> = {
    FREE: { daily: 5, minute: 1 },
    REGULAR: { daily: 25, minute: 5 },
    PREMIUM: { daily: 100, minute: 10 },
    RESELLER: { daily: 500, minute: 30 },
    BUSINESS: { daily: 2500, minute: 100 },
    CUSTOM: { daily: 10000, minute: 500 },
  };

  return limits[org.plan as Plan];
}
