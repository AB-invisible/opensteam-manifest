import { OrgRole } from '@prisma/client';

/** Invites may only assign MEMBER or ADMIN — never OWNER via client input. */
export function normalizeInvitedOrgRole(role: unknown): OrgRole {
  if (role === OrgRole.ADMIN) return OrgRole.ADMIN;
  return OrgRole.MEMBER;
}
