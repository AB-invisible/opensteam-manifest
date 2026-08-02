import { describe, it, expect } from 'vitest'
import { moderateScript } from '@/app/lib/moderator'

describe('moderateScript', () => {
  it('rejects external fetch calls', async () => {
    const result = await moderateScript('const x = fetch("https://evil.com")')
    expect(result.status).toBe('REJECTED')
  })

  it('rejects eval', async () => {
    const result = await moderateScript('eval("alert(1)")')
    expect(result.status).toBe('REJECTED')
  })

  it('rejects scripts that are too short', async () => {
    const result = await moderateScript('x')
    expect(result.status).toBe('REJECTED')
  })

  it('approves benign extraction logic', async () => {
    const result = await moderateScript('return context.manifest.appId;')
    expect(['APPROVED', 'PENDING']).toContain(result.status)
  })
})
