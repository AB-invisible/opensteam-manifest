import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isDiscordQuarantineResponse,
  parseDiscordApiErrorBody,
} from '@/app/lib/discord-bot-credentials'

describe('discord-bot-credentials quarantine detection', () => {
  it('detects Discord anti-spam quarantine code 20026', () => {
    const body = JSON.stringify({
      message:
        'Your bot has been flagged by our anti-spam system for abusive behavior.',
      code: 20026,
    })
    expect(isDiscordQuarantineResponse(403, body)).toBe(true)
    expect(parseDiscordApiErrorBody(body).code).toBe(20026)
  })

  it('ignores non-quarantine 403 responses', () => {
    const body = JSON.stringify({ message: 'Missing Access', code: 50001 })
    expect(isDiscordQuarantineResponse(403, body)).toBe(false)
  })

  it('ignores quarantine code on non-403 status', () => {
    const body = JSON.stringify({ code: 20026 })
    expect(isDiscordQuarantineResponse(500, body)).toBe(false)
  })
})

describe('release-test unlock semantics', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('unlocks exam without discordId (dmSkipped, no 400)', async () => {
    const now = new Date('2026-06-28T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const updateMock = vi.fn().mockResolvedValue({})
    const findUniqueMock = vi.fn().mockResolvedValue({
      id: 'user-1',
      discordId: null,
      email: 'candidate@example.com',
      username: 'candidate',
    })

    vi.doMock('@/app/lib/prisma', () => ({
      prisma: {
        user: {
          findUnique: findUniqueMock,
          update: updateMock,
        },
      },
    }))

    vi.doMock('@/app/lib/auth-helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        ok: true,
        data: { dbUser: { role: 'OWNER' } },
      }),
      isPrivilegedStaff: vi.fn().mockReturnValue(true),
      safeErrorMessage: (e: unknown) => String(e),
    }))

    vi.doMock('@/app/lib/discord-dm', () => ({
      trySendDiscordDm: vi.fn(),
    }))

    vi.doMock('@/app/lib/email', () => ({
      sendBrandedEmail: vi.fn().mockResolvedValue(undefined),
    }))

    const { POST } = await import('@/app/api/admin/trial-mods/route')
    const req = new Request('http://localhost/api/admin/trial-mods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release-test', userId: 'user-1' }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.modTestReadyAt).toBe(now.toISOString())
    expect(data.dmSkipped).toBe(true)
    expect(data.dmSent).toBe(false)
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        trialModEndsAt: now,
        modTestReadyAt: now,
      },
    })

    vi.useRealTimers()
  })

  it('sets modTestReadyAt even when DM fails with quarantine', async () => {
    const now = new Date('2026-06-28T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const updateMock = vi.fn().mockResolvedValue({})
    const trySendDiscordDm = vi.fn().mockResolvedValue({
      sent: false,
      error: 'Discord DM failed: 403 {"code":20026}',
      quarantineDetected: true,
    })

    vi.doMock('@/app/lib/prisma', () => ({
      prisma: {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-2',
            discordId: '1454571852717363290',
            email: null,
            username: 'mod',
          }),
          update: updateMock,
        },
      },
    }))

    vi.doMock('@/app/lib/auth-helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({
        ok: true,
        data: { dbUser: { role: 'ADMIN' } },
      }),
      isPrivilegedStaff: vi.fn().mockReturnValue(true),
      safeErrorMessage: (e: unknown) => String(e),
    }))

    vi.doMock('@/app/lib/discord-dm', () => ({ trySendDiscordDm }))

    const { POST } = await import('@/app/api/admin/trial-mods/route')
    const req = new Request('http://localhost/api/admin/trial-mods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release-test', userId: 'user-2' }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.modTestReadyAt).toBe(now.toISOString())
    expect(data.dmSent).toBe(false)
    expect(data.dmWarning).toContain('20026')
    expect(trySendDiscordDm).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
