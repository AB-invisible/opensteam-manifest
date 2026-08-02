import { describe, it, expect } from 'vitest'
import { parseSignedVerifyParam } from '@/app/lib/discord-verify-session'

describe('parseSignedVerifyParam', () => {
  it('returns null for malformed signed params', () => {
    expect(parseSignedVerifyParam('')).toBeNull()
    expect(parseSignedVerifyParam('not-valid')).toBeNull()
    expect(parseSignedVerifyParam('abc.def')).toBeNull()
  })
})
