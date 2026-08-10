import { describe, expect, it } from 'vitest'
import {
  buildAltBlockMessage,
  evaluateVerificationAltBlock,
  parseAltBlockFlags,
  parseVerificationAltBlockMode,
} from '@/app/lib/verification-alt-policy'

describe('verification alt block policy', () => {
  const altResult = {
    altMatchedUserIds: ['user-1'],
    flags: ['ip_match', 'fingerprint_match', 'friend_of_banned'],
  }

  it('defaults unknown or empty modes to alert-only', () => {
    expect(parseVerificationAltBlockMode(null)).toBe('off')
    expect(parseVerificationAltBlockMode('observe')).toBe('off')
    expect(parseVerificationAltBlockMode('wat')).toBe('off')
  })

  it('parses mode aliases and custom flags', () => {
    expect(parseVerificationAltBlockMode('strict')).toBe('strong')
    expect(parseVerificationAltBlockMode('all')).toBe('any')
    expect(parseVerificationAltBlockMode('custom')).toBe('custom')
    expect(parseAltBlockFlags('ip_match, fingerprint_match,ip_match')).toEqual([
      'ip_match',
      'fingerprint_match',
    ])
  })

  it('does not block when mode is off', () => {
    const result = evaluateVerificationAltBlock(altResult, { mode: 'off', customFlags: [] })
    expect(result.blocked).toBe(false)
    expect(result.blockedFlags).toEqual([])
  })

  it('blocks only strong flags in strong mode', () => {
    const result = evaluateVerificationAltBlock(altResult, { mode: 'strong', customFlags: [] })
    expect(result.blocked).toBe(true)
    expect(result.blockedFlags).toEqual(['fingerprint_match'])
  })

  it('blocks all matched flags in any mode', () => {
    const result = evaluateVerificationAltBlock(altResult, { mode: 'any', customFlags: [] })
    expect(result.blocked).toBe(true)
    expect(result.blockedFlags).toEqual(['ip_match', 'fingerprint_match', 'friend_of_banned'])
  })

  it('blocks only configured custom flags', () => {
    const result = evaluateVerificationAltBlock(altResult, {
      mode: 'custom',
      customFlags: ['friend_of_banned'],
    })
    expect(result.blocked).toBe(true)
    expect(result.blockedFlags).toEqual(['friend_of_banned'])
  })

  it('builds a user-facing block message', () => {
    expect(buildAltBlockMessage(['fingerprint_match'])).toContain('shared browser/device fingerprint')
    expect(
      buildAltBlockMessage(['ip_match'], [{ username: 'main', discordId: '111', inGuild: true }]),
    ).toContain('<@111>')
    expect(
      buildAltBlockMessage(['ip_match'], [{ username: 'main', discordId: '111', inGuild: true }]),
    ).toContain('already have an account in this server')
  })
})
