import { describe, expect, it } from 'vitest'
import { OrgRole } from '@prisma/client'
import { normalizeInvitedOrgRole } from '@/app/lib/org-roles'

describe('normalizeInvitedOrgRole', () => {
  it('allows ADMIN invites', () => {
    expect(normalizeInvitedOrgRole(OrgRole.ADMIN)).toBe(OrgRole.ADMIN)
  })

  it('defaults unknown roles to MEMBER', () => {
    expect(normalizeInvitedOrgRole(undefined)).toBe(OrgRole.MEMBER)
    expect(normalizeInvitedOrgRole(OrgRole.OWNER)).toBe(OrgRole.MEMBER)
    expect(normalizeInvitedOrgRole('OWNER')).toBe(OrgRole.MEMBER)
  })
})
