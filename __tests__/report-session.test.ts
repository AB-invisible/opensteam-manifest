import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateApiKeyMock = vi.fn()
const findUniqueMock = vi.fn()
const upsertMock = vi.fn()
const createEventMock = vi.fn()

vi.mock('@/app/lib/auth', () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
  apiHeaders: vi.fn().mockReturnValue({}),
}))

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    appSession: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
    appEvent: {
      create: (...args: unknown[]) => createEventMock(...args),
    },
  },
}))

const VALID_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('/api/report session binding', () => {
  beforeEach(() => {
    vi.resetModules()
    authenticateApiKeyMock.mockReset()
    findUniqueMock.mockReset()
    upsertMock.mockReset()
    createEventMock.mockReset()

    authenticateApiKeyMock.mockResolvedValue({
      apiKeyId: 'key-a',
      user: { id: 'user-a' },
      apiKey: { adminDisable: false, adminForceUpdate: false },
      rateLimit: { allowed: true, remaining: 10, limit: 100, resetAt: 0 },
      dailyQuota: { allowed: true, remaining: 50, limit: 100, resetAt: 0 },
    })
    upsertMock.mockResolvedValue({ id: VALID_SESSION_ID })
  })

  async function postReport(sessionId: string) {
    const { POST } = await import('@/app/api/report/route')
    const req = new NextRequest('http://localhost/api/report', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        apiKey: 'mg_test_key',
        appVersion: '1.0.0',
      }),
    })
    return POST(req)
  }

  it('rejects invalid sessionId format', async () => {
    const res = await postReport('not-a-uuid')
    expect(res.status).toBe(400)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('returns 403 when session belongs to a different api key', async () => {
    findUniqueMock.mockResolvedValue({ id: VALID_SESSION_ID, apiKeyId: 'key-b' })

    const res = await postReport(VALID_SESSION_ID)
    expect(res.status).toBe(403)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('upserts when session does not exist', async () => {
    findUniqueMock.mockResolvedValue(null)

    const res = await postReport(VALID_SESSION_ID)
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalled()
  })

  it('upserts when session belongs to the same api key', async () => {
    findUniqueMock.mockResolvedValue({ id: VALID_SESSION_ID, apiKeyId: 'key-a' })

    const res = await postReport(VALID_SESSION_ID)
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalled()
  })
})
