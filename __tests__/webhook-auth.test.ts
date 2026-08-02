import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueMock = vi.fn()

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}))

describe('telegram webhook auth', () => {
  beforeEach(() => {
    vi.resetModules()
    findUniqueMock.mockReset()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })

  it('verifyTelegramWebhookSecret accepts matching token', async () => {
    const { verifyTelegramWebhookSecret } = await import('@/app/lib/telegram-webhook-auth')
    expect(verifyTelegramWebhookSecret('abc123', 'abc123')).toBe(true)
  })

  it('verifyTelegramWebhookSecret rejects missing or wrong token', async () => {
    const { verifyTelegramWebhookSecret } = await import('@/app/lib/telegram-webhook-auth')
    expect(verifyTelegramWebhookSecret(null, 'abc123')).toBe(false)
    expect(verifyTelegramWebhookSecret('wrong', 'abc123')).toBe(false)
  })

  it('getTelegramWebhookSecret prefers env over system config', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'env-secret'
    findUniqueMock.mockResolvedValue({ value: 'db-secret' })

    const { getTelegramWebhookSecret } = await import('@/app/lib/telegram-webhook-auth')
    await expect(getTelegramWebhookSecret()).resolves.toBe('env-secret')
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('getTelegramWebhookSecret falls back to system config', async () => {
    findUniqueMock.mockResolvedValue({ value: 'db-secret' })

    const { getTelegramWebhookSecret } = await import('@/app/lib/telegram-webhook-auth')
    await expect(getTelegramWebhookSecret()).resolves.toBe('db-secret')
  })
})

describe('telegram webhook route auth gate', () => {
  beforeEach(() => {
    vi.resetModules()
    findUniqueMock.mockReset()
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    delete (process.env as any).NODE_ENV
  })

  it('returns 503 in production when secret is not configured', async () => {
    ;(process.env as any).NODE_ENV = 'production'
    findUniqueMock.mockResolvedValue(null)

    vi.doMock('@/app/lib/telegram-bot', () => ({
      sendTelegramMessage: vi.fn(),
      sendTelegramDocument: vi.fn(),
      sendTelegramPublicPromo: vi.fn(),
      sendTelegramChatAction: vi.fn(),
    }))

    const { POST } = await import('@/app/api/webhooks/telegram/route')
    const req = new Request('http://localhost/api/webhooks/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { text: '/help', chat: { id: 1 } } }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(503)
  })

  it('returns 401 when secret token header does not match', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'expected-secret'

    vi.doMock('@/app/lib/telegram-bot', () => ({
      sendTelegramMessage: vi.fn(),
      sendTelegramDocument: vi.fn(),
      sendTelegramPublicPromo: vi.fn(),
      sendTelegramChatAction: vi.fn(),
    }))

    const { POST } = await import('@/app/api/webhooks/telegram/route')
    const req = new Request('http://localhost/api/webhooks/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
      },
      body: JSON.stringify({ message: { text: '/help', chat: { id: 1 } } }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })
})
