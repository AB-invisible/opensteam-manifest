import { describe, expect, it } from 'vitest'
import { isUsableIpForAltMatch } from '@/app/lib/generation-alt-gate'

describe('generation alt gate', () => {
  it('rejects placeholder and private IPs for alt matching', () => {
    expect(isUsableIpForAltMatch('unknown')).toBe(false)
    expect(isUsableIpForAltMatch('')).toBe(false)
    expect(isUsableIpForAltMatch('127.0.0.1')).toBe(false)
    expect(isUsableIpForAltMatch('192.168.1.4')).toBe(false)
  })

  it('accepts real public IPs', () => {
    expect(isUsableIpForAltMatch('8.8.8.8')).toBe(true)
    expect(isUsableIpForAltMatch('203.0.113.10')).toBe(true)
  })
})
