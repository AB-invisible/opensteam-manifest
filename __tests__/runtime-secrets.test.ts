import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const findUniqueMock = vi.fn()

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}))

describe('runtime-secrets', () => {
  beforeEach(() => {
    vi.resetModules()
    findUniqueMock.mockReset()
    delete process.env.TEST_SECRET
    delete (process.env as any).NODE_ENV
  })

  it('getRuntimeSecret prefers env over database', async () => {
    process.env.TEST_SECRET = 'from-env'
    findUniqueMock.mockResolvedValue({ value: 'from-db' })

    const { getRuntimeSecret } = await import('@/app/lib/runtime-secrets')
    await expect(getRuntimeSecret('TEST_SECRET')).resolves.toBe('from-env')
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('getRuntimeSecret falls back to database', async () => {
    findUniqueMock.mockResolvedValue({ value: 'from-db' })

    const { getRuntimeSecret } = await import('@/app/lib/runtime-secrets')
    await expect(getRuntimeSecret('TEST_SECRET')).resolves.toBe('from-db')
  })

  it('requireRuntimeSecretInProduction returns 503 when secret missing in production', async () => {
    ;(process.env as any).NODE_ENV = 'production'

    const { requireRuntimeSecretInProduction } = await import('@/app/lib/runtime-secrets')
    const response = requireRuntimeSecretInProduction(null, 'TEST_SECRET', 'Test')
    expect(response).toBeInstanceOf(NextResponse)
    expect(response?.status).toBe(503)
  })

  it('requireRuntimeSecretInProduction returns null when secret is set', async () => {
    ;(process.env as any).NODE_ENV = 'production'

    const { requireRuntimeSecretInProduction } = await import('@/app/lib/runtime-secrets')
    expect(requireRuntimeSecretInProduction('abc', 'TEST_SECRET')).toBeNull()
  })
})
