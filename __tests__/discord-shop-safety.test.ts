import { describe, expect, it } from 'vitest'

const {
  shouldModerateShopText,
  validateShopTextValue,
} = require('../scripts/lib/shop-safety')

describe('discord shop text safety', () => {
  it('moderates nickname and public-text shop items', () => {
    expect(shouldModerateShopText('nickname')).toBe(true)
    expect(shouldModerateShopText('heckle')).toBe(true)
    expect(shouldModerateShopText('shoutout')).toBe(true)
    expect(shouldModerateShopText('pin')).toBe(false)
    expect(shouldModerateShopText('color')).toBe(false)
  })

  it('allows normal shop text', () => {
    expect(validateShopTextValue('nickname', 'Steam Helper')).toEqual({ ok: true })
    expect(validateShopTextValue('shoutout', 'Thanks for helping with my request today')).toEqual({ ok: true })
  })

  it('blocks rude or unsafe text', () => {
    expect(validateShopTextValue('nickname', 'trash loser').ok).toBe(false)
    expect(validateShopTextValue('shoutout', 'visit only fans').ok).toBe(false)
    expect(validateShopTextValue('heckle', 'k y s').ok).toBe(false)
  })

  it('does not scan non-text values like pins and colors', () => {
    expect(validateShopTextValue('pin', '123456789012345678')).toEqual({ ok: true })
    expect(validateShopTextValue('color', '#FF0055')).toEqual({ ok: true })
  })
})
