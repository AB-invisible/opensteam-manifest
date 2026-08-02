import { describe, expect, it } from 'vitest'
import { parseBearerToken, verifyBearerSecret } from '@/app/lib/bearer-auth'

describe('bearer-auth', () => {
  it('parseBearerToken extracts token from Authorization header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123')
    expect(parseBearerToken('bearer token-with-dash')).toBe('token-with-dash')
  })

  it('parseBearerToken rejects malformed headers', () => {
    expect(parseBearerToken(null)).toBeNull()
    expect(parseBearerToken('abc123')).toBeNull()
    expect(parseBearerToken('Basic abc123')).toBeNull()
  })

  it('verifyBearerSecret accepts matching bearer token', () => {
    expect(verifyBearerSecret('Bearer secret', 'secret')).toBe(true)
  })

  it('verifyBearerSecret rejects wrong or missing values', () => {
    expect(verifyBearerSecret('Bearer wrong', 'secret')).toBe(false)
    expect(verifyBearerSecret('Bearer secret', '')).toBe(false)
    expect(verifyBearerSecret(null, 'secret')).toBe(false)
  })
})
