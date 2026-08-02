import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueMock = vi.fn()
const upsertMock = vi.fn()
const systemNotificationFindFirstMock = vi.fn()
const systemNotificationUpdateMock = vi.fn()

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
    systemNotification: {
      findFirst: (...args: unknown[]) => systemNotificationFindFirstMock(...args),
      update: (...args: unknown[]) => systemNotificationUpdateMock(...args),
    },
  },
}))

describe('sendBotDmWithFailover routing', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    findUniqueMock.mockReset()
    upsertMock.mockReset()
    systemNotificationFindFirstMock.mockReset()
    systemNotificationUpdateMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    delete process.env.DISCORD_BOT_FAILOVER_MODE
    delete process.env.DISCORD_BOT_QUARANTINED
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.DISCORD_BACKUP_BOT_TOKEN
    delete process.env.DISCORD_AUTO_OUTAGE_BANNER
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockConfig(map: Record<string, string>) {
    findUniqueMock.mockImplementation(({ where }: { where: { key: string } }) => {
      const value = map[where.key]
      return value ? { key: where.key, value } : null
    })
  }

  async function loadSender() {
    const mod = await import('@/app/lib/discord-bot-credentials')
    return mod.sendBotDmWithFailover
  }

  it('does not fall back to backup for ordinary primary DM failures in auto mode', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'auto',
      DISCORD_BOT_QUARANTINED: 'false',
      DISCORD_BOT_TOKEN: 'primary-token',
      DISCORD_BACKUP_BOT_TOKEN: 'backup-token',
    })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: 50001, message: 'Missing Access' }),
    })

    const send = await loadSender()
    const result = await send('123', 'hello')

    expect(result).toMatchObject({
      sent: false,
      tokenUsed: 'primary',
      quarantineDetected: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bot primary-token')
  })

  it('uses only the backup bot when auto mode is already quarantined', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'auto',
      DISCORD_BOT_QUARANTINED: 'true',
      DISCORD_BOT_TOKEN: 'primary-token',
      DISCORD_BACKUP_BOT_TOKEN: 'backup-token',
    })
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'dm-channel' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      })

    const send = await loadSender()
    const result = await send('123', 'hello')

    expect(result).toMatchObject({ sent: true, tokenUsed: 'backup' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1].headers.Authorization)).toEqual([
      'Bot backup-token',
      'Bot backup-token',
    ])
  })

  it('switches to backup once when primary returns the Discord quarantine code in auto mode', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'auto',
      DISCORD_BOT_QUARANTINED: 'false',
      DISCORD_BOT_TOKEN: 'primary-token',
      DISCORD_BACKUP_BOT_TOKEN: 'backup-token',
      DISCORD_AUTO_OUTAGE_BANNER: 'false',
    })
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ code: 20026, message: 'Quarantined' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'dm-channel' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      })

    const send = await loadSender()
    const result = await send('123', 'hello')

    expect(result).toMatchObject({
      sent: true,
      tokenUsed: 'backup',
      quarantineDetected: true,
    })
    expect(upsertMock).toHaveBeenCalledWith({
      where: { key: 'DISCORD_BOT_QUARANTINED' },
      update: { value: 'true' },
      create: { key: 'DISCORD_BOT_QUARANTINED', value: 'true', isSecret: false },
    })
    expect(fetchMock.mock.calls.map((call) => call[1].headers.Authorization)).toEqual([
      'Bot primary-token',
      'Bot backup-token',
      'Bot backup-token',
    ])
  })
})
