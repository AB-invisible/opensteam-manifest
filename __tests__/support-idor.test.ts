import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getServerSessionMock = vi.fn()
const findUniqueMock = vi.fn()
const updateMock = vi.fn()
const createReplyMock = vi.fn()
const runSupportAgentMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}))

vi.mock('@/app/lib/auth-options', () => ({ authOptions: {} }))

vi.mock('@/app/lib/email', () => ({
  sendBrandedEmail: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/lib/support-agent', () => ({
  runSupportAgent: (...args: unknown[]) => runSupportAgentMock(...args),
}))

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    supportTicketReply: {
      create: (...args: unknown[]) => createReplyMock(...args),
    },
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

describe('support ticket follow-up IDOR protection', () => {
  beforeEach(() => {
    vi.resetModules()
    getServerSessionMock.mockReset()
    findUniqueMock.mockReset()
    updateMock.mockReset()
    createReplyMock.mockReset()
    runSupportAgentMock.mockReset()

    findUniqueMock.mockResolvedValue({
      id: 'ticket-1',
      ticketNumber: 'GG-123456',
      fromEmail: 'owner@example.com',
      fromName: 'Owner',
      subject: 'Help',
    })
    updateMock.mockResolvedValue({})
    createReplyMock.mockResolvedValue({ id: 'reply-1' })
    runSupportAgentMock.mockResolvedValue(null)
  })

  async function postFollowUp() {
    const { POST } = await import('@/app/api/support/route')
    const req = new NextRequest('http://localhost/api/support', {
      method: 'POST',
      body: JSON.stringify({ ticketId: 'ticket-1', reply: 'Follow up message' }),
    })
    return POST(req)
  }

  it('returns 401 when session is missing', async () => {
    getServerSessionMock.mockResolvedValue(null)

    const res = await postFollowUp()
    expect(res.status).toBe(401)
    expect(createReplyMock).not.toHaveBeenCalled()
  })

  it('returns 403 when session email does not match ticket owner', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: 'attacker@example.com', role: 'USER' },
    })

    const res = await postFollowUp()
    expect(res.status).toBe(403)
    expect(createReplyMock).not.toHaveBeenCalled()
  })

  it('allows ticket owner to reply', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: 'owner@example.com', role: 'USER' },
    })

    const res = await postFollowUp()
    expect(res.status).toBe(200)
    expect(createReplyMock).toHaveBeenCalled()
  })

  it('allows staff to reply on any ticket', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: 'mod@example.com', role: 'MODERATOR' },
    })

    const res = await postFollowUp()
    expect(res.status).toBe(200)
    expect(createReplyMock).toHaveBeenCalled()
  })
})
