import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendBotDMMock = vi.fn()
const findUniqueMock = vi.fn()
const updateManyMock = vi.fn()
const createMock = vi.fn()
const getVerifyChannelLinkMock = vi.fn()
const getCommunityInviteLinksMock = vi.fn()

vi.mock('@/app/lib/bot-admin', () => ({
  sendBotDM: (...args: unknown[]) => sendBotDMMock(...args),
}))

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}))

vi.mock('@/app/lib/discord-community-links', () => ({
  DISCORD_COMMUNITY_LINKS: {
    rules: 'https://discord.com/channels/guild/rules',
  },
  getVerifyChannelLink: (...args: unknown[]) => getVerifyChannelLinkMock(...args),
  getCommunityInviteLinks: (...args: unknown[]) => getCommunityInviteLinksMock(...args),
}))

describe('notifyGuildJoinWelcome', () => {
  beforeEach(() => {
    vi.resetModules()
    sendBotDMMock.mockReset()
    findUniqueMock.mockReset()
    updateManyMock.mockReset()
    createMock.mockReset()
    getVerifyChannelLinkMock.mockReset()
    getCommunityInviteLinksMock.mockReset()
    sendBotDMMock.mockResolvedValue(true)
    findUniqueMock.mockResolvedValue(null)
    createMock.mockResolvedValue({})
    getVerifyChannelLinkMock.mockResolvedValue('https://discord.com/channels/guild/verify')
    getCommunityInviteLinksMock.mockResolvedValue([
      'https://discord.gg/primary',
      'https://discord.gg/extra',
    ])
  })

  async function loadNotifier() {
    const mod = await import('@/app/lib/discord-guild-join-welcome')
    return mod.notifyGuildJoinWelcome
  }

  it('sends one server invite in the join instructions', async () => {
    const notify = await loadNotifier()
    const result = await notify({
      discordId: '123',
      username: 'new-user',
    })

    expect(result).toEqual({ sent: true })
    expect(sendBotDMMock).toHaveBeenCalledTimes(1)
    const embed = sendBotDMMock.mock.calls[0][2]
    expect(embed.description).toContain('**Server invite:** https://discord.gg/primary')
    expect(embed.description).not.toContain('https://discord.gg/extra')
    expect(embed.description).not.toContain('Server invites')
  })

  it('skips duplicate welcome DMs while the de-dupe key is fresh', async () => {
    findUniqueMock.mockResolvedValue({
      updatedAt: new Date(),
    })

    const notify = await loadNotifier()
    const result = await notify({
      discordId: '123',
      username: 'new-user',
    })

    expect(result).toEqual({ sent: false })
    expect(sendBotDMMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
    expect(updateManyMock).not.toHaveBeenCalled()
  })
})
