import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueMock = vi.fn()

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}))

describe('resolveActiveOAuthCredentials', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
    delete process.env.DISCORD_BACKUP_CLIENT_ID
    delete process.env.DISCORD_BACKUP_CLIENT_SECRET
    delete process.env.DISCORD_BOT_FAILOVER_MODE
    delete process.env.DISCORD_BOT_QUARANTINED
  })

  async function load() {
    vi.resetModules()
    const mod = await import('@/app/lib/discord-bot-credentials')
    return mod.resolveActiveOAuthCredentials
  }

  function mockConfig(map: Record<string, string>) {
    findUniqueMock.mockImplementation(({ where }: { where: { key: string } }) => {
      const value = map[where.key]
      return value ? { key: where.key, value } : null
    })
  }

  it('returns primary OAuth credentials when failover mode is primary', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'primary',
      DISCORD_CLIENT_ID: 'primary-id',
      DISCORD_CLIENT_SECRET: 'primary-secret',
      DISCORD_BACKUP_CLIENT_ID: 'backup-id',
      DISCORD_BACKUP_CLIENT_SECRET: 'backup-secret',
    })

    const resolve = await load()
    const result = await resolve()

    expect(result).toEqual({
      clientId: 'primary-id',
      clientSecret: 'primary-secret',
      source: 'primary',
    })
  })

  it('returns backup OAuth credentials when failover mode is backup', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'backup',
      DISCORD_CLIENT_ID: 'primary-id',
      DISCORD_CLIENT_SECRET: 'primary-secret',
      DISCORD_BACKUP_CLIENT_ID: 'backup-id',
      DISCORD_BACKUP_CLIENT_SECRET: 'backup-secret',
    })

    const resolve = await load()
    const result = await resolve()

    expect(result).toEqual({
      clientId: 'backup-id',
      clientSecret: 'backup-secret',
      source: 'backup',
    })
  })

  it('falls back to primary when backup mode is active but backup OAuth is not configured', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'backup',
      DISCORD_CLIENT_ID: 'primary-id',
      DISCORD_CLIENT_SECRET: 'primary-secret',
    })

    const resolve = await load()
    const result = await resolve()

    expect(result).toEqual({
      clientId: 'primary-id',
      clientSecret: 'primary-secret',
      source: 'primary',
    })
  })
})

describe('resolveGuildBotToken', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.DISCORD_BACKUP_BOT_TOKEN
    delete process.env.DISCORD_BOT_FAILOVER_MODE
    delete process.env.DISCORD_BOT_QUARANTINED
  })

  async function loadGuild() {
    vi.resetModules()
    const mod = await import('@/app/lib/discord-bot-credentials')
    return mod.resolveGuildBotToken
  }

  function mockConfig(map: Record<string, string>) {
    findUniqueMock.mockImplementation(({ where }: { where: { key: string } }) => {
      const value = map[where.key]
      return value ? { key: where.key, value } : null
    })
  }

  it('uses primary bot for guild commands even when failover mode is backup', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'backup',
      DISCORD_BOT_TOKEN: 'primary-token',
      DISCORD_BACKUP_BOT_TOKEN: 'backup-token',
    })

    const resolve = await loadGuild()
    const result = await resolve()

    expect(result).toEqual({
      token: 'primary-token',
      source: 'primary',
    })
  })

  it('falls back to backup guild token only when primary is not configured', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'backup',
      DISCORD_BACKUP_BOT_TOKEN: 'backup-token',
    })

    const resolve = await loadGuild()
    const result = await resolve()

    expect(result).toEqual({
      token: 'backup-token',
      source: 'backup',
    })
  })
})

describe('resolveGuildJoinBotToken', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.DISCORD_BACKUP_BOT_TOKEN
    delete process.env.DISCORD_BACKUP_CLIENT_ID
    delete process.env.DISCORD_BACKUP_CLIENT_SECRET
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
    delete process.env.DISCORD_BOT_FAILOVER_MODE
  })

  async function loadJoin() {
    vi.resetModules()
    const mod = await import('@/app/lib/discord-bot-credentials')
    return mod.resolveGuildJoinBotToken
  }

  function mockConfig(map: Record<string, string>) {
    findUniqueMock.mockImplementation(({ where }: { where: { key: string } }) => {
      const value = map[where.key]
      return value ? { key: where.key, value } : null
    })
  }

  it('uses backup bot for guilds.join when backup OAuth is active', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'backup',
      DISCORD_BACKUP_CLIENT_ID: 'backup-client',
      DISCORD_BACKUP_CLIENT_SECRET: 'backup-secret',
      DISCORD_BOT_TOKEN: 'primary-token',
      DISCORD_BACKUP_BOT_TOKEN: 'backup-token',
    })

    const resolve = await loadJoin()
    const result = await resolve()

    expect(result).toEqual({
      token: 'backup-token',
      source: 'backup',
    })
  })
})
