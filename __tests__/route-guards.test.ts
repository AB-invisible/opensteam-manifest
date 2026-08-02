import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canAccessSupportTicket } from '@/app/lib/route-guards'

describe('canAccessSupportTicket', () => {
  it('allows ticket owner', () => {
    expect(
      canAccessSupportTicket({ email: 'owner@example.com', role: 'USER' }, { fromEmail: 'owner@example.com' })
    ).toBe(true)
  })

  it('allows staff on any ticket', () => {
    expect(
      canAccessSupportTicket({ email: 'mod@example.com', role: 'MODERATOR' }, { fromEmail: 'owner@example.com' })
    ).toBe(true)
  })

  it('denies non-owner non-staff', () => {
    expect(
      canAccessSupportTicket({ email: 'other@example.com', role: 'USER' }, { fromEmail: 'owner@example.com' })
    ).toBe(false)
  })
})

describe('assertAppSessionOwnership', () => {
  const findUniqueMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    findUniqueMock.mockReset()
  })

  it('rejects invalid session id format', async () => {
    vi.doMock('@/app/lib/prisma', () => ({
      prisma: { appSession: { findUnique: findUniqueMock } },
    }))

    const { assertAppSessionOwnership } = await import('@/app/lib/app-session')
    const result = await assertAppSessionOwnership('not-a-uuid', 'key-a')
    expect(result).toEqual({ ok: false, status: 400 })
  })
})
