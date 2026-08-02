import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  OAUTH_SOURCE_COOKIE,
  clearOAuthSourceCookie,
  parseOAuthSourceCookie,
  setOAuthSourceCookie,
} from '@/app/lib/discord-oauth-flow-bridge'

const findUniqueMock = vi.fn()
const updateManyMock = vi.fn()

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    user: {
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}))

describe('discord-oauth-flow-bridge', () => {
  it('parses pinned OAuth source cookie', () => {
    expect(parseOAuthSourceCookie({ [OAUTH_SOURCE_COOKIE]: 'backup' })).toBe('backup')
    expect(parseOAuthSourceCookie({ [OAUTH_SOURCE_COOKIE]: 'primary' })).toBe('primary')
    expect(parseOAuthSourceCookie({ [OAUTH_SOURCE_COOKIE]: 'invalid' })).toBeNull()
    expect(parseOAuthSourceCookie({})).toBeNull()
  })

  it('sets the OAuth source cookie on plain route-handler responses', () => {
    const response = new Response(null)

    setOAuthSourceCookie(response, 'backup')

    expect(response.headers.get('set-cookie')).toContain(`${OAUTH_SOURCE_COOKIE}=backup`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=1800')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
  })

  it('clears the OAuth source cookie on plain route-handler responses', () => {
    const response = new Response(null)

    clearOAuthSourceCookie(response)

    expect(response.headers.get('set-cookie')).toContain(`${OAUTH_SOURCE_COOKIE}=`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('uses NextResponse-style cookie helpers when available', () => {
    const set = vi.fn()
    const response = { cookies: { set } } as any

    setOAuthSourceCookie(response, 'primary')

    expect(set).toHaveBeenCalledWith(
      OAUTH_SOURCE_COOKIE,
      'primary',
      expect.objectContaining({ maxAge: 1800, httpOnly: true, sameSite: 'lax' })
    )
  })
})

describe('resolveOAuthCredentialsBySource', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
    delete process.env.DISCORD_BACKUP_CLIENT_ID
    delete process.env.DISCORD_BACKUP_CLIENT_SECRET
  })

  async function load() {
    vi.resetModules()
    const mod = await import('@/app/lib/discord-bot-credentials')
    return mod.resolveOAuthCredentialsBySource
  }

  function mockConfig(map: Record<string, string>) {
    findUniqueMock.mockImplementation(({ where }: { where: { key: string } }) => {
      const value = map[where.key]
      return value ? { key: where.key, value } : null
    })
  }

  it('returns backup credentials when source is backup', async () => {
    mockConfig({
      DISCORD_BACKUP_CLIENT_ID: 'backup-id',
      DISCORD_BACKUP_CLIENT_SECRET: 'backup-secret',
    })

    const resolve = await load()
    const result = await resolve('backup')

    expect(result).toEqual({
      clientId: 'backup-id',
      clientSecret: 'backup-secret',
      source: 'backup',
    })
  })

  it('falls back to primary when backup source is requested but not configured', async () => {
    mockConfig({
      DISCORD_CLIENT_ID: 'primary-id',
      DISCORD_CLIENT_SECRET: 'primary-secret',
    })

    const resolve = await load()
    const result = await resolve('backup')

    expect(result).toEqual({
      clientId: 'primary-id',
      clientSecret: 'primary-secret',
      source: 'primary',
    })
  })

  it('returns primary credentials when source is primary without checking failover', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'backup',
      DISCORD_BACKUP_CLIENT_ID: 'backup-id',
      DISCORD_BACKUP_CLIENT_SECRET: 'backup-secret',
      DISCORD_CLIENT_ID: 'primary-id',
      DISCORD_CLIENT_SECRET: 'primary-secret',
    })

    const resolve = await load()
    const result = await resolve('primary')

    expect(result).toEqual({
      clientId: 'primary-id',
      clientSecret: 'primary-secret',
      source: 'primary',
    })
  })
})

describe('refreshDiscordAccessToken alternate OAuth app', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    findUniqueMock.mockReset()
    updateManyMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_CLIENT_SECRET
    delete process.env.DISCORD_BACKUP_CLIENT_ID
    delete process.env.DISCORD_BACKUP_CLIENT_SECRET
    delete process.env.DISCORD_BOT_FAILOVER_MODE
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

  async function loadRefresh() {
    vi.resetModules()
    const mod = await import('@/app/lib/discord-oauth-tokens')
    return mod.refreshDiscordAccessToken
  }

  it('retries refresh with backup OAuth app when primary returns invalid_grant', async () => {
    mockConfig({
      DISCORD_BOT_FAILOVER_MODE: 'primary',
      DISCORD_CLIENT_ID: 'primary-id',
      DISCORD_CLIENT_SECRET: 'primary-secret',
      DISCORD_BACKUP_CLIENT_ID: 'backup-id',
      DISCORD_BACKUP_CLIENT_SECRET: 'backup-secret',
    })
    updateManyMock.mockResolvedValue({ count: 1 })

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
        }),
      })

    const refresh = await loadRefresh()
    const token = await refresh('123', 'old-refresh')

    expect(token).toBe('new-access')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = String(fetchMock.mock.calls[1][1]?.body)
    expect(secondBody).toContain('backup-id')
  })
})
