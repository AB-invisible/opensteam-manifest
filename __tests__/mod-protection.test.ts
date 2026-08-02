import { describe, expect, it } from 'vitest'

const { getProtectedModerationReason } = require('../scripts/lib/mod-protection')

describe('mod protection', () => {
  it('blocks mute and heckle actions against staff platform roles', async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ role: 'MODERATOR' }),
      },
    }

    const targetUser = { id: '1', bot: false }
    const targetMember = {
      user: targetUser,
      guild: { id: 'guild' },
      permissions: { has: () => false },
      roles: { cache: { find: () => null } },
    }

    await expect(
      getProtectedModerationReason(prisma, targetUser, targetMember, { action: 'mute' }),
    ).resolves.toMatch(/cannot mute or timeout/i)

    await expect(
      getProtectedModerationReason(prisma, targetUser, targetMember, { action: 'heckle' }),
    ).resolves.toMatch(/cannot heckle/i)
  })
})
