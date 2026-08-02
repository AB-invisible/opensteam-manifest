import { describe, expect, it } from 'vitest'
import {
  STEAM_ACCOUNT_PRODUCTS,
  formatProductPrice,
  getSteamAccountProduct,
  getPublicSteamAccountProducts,
} from '@/app/lib/steam-accounts-shop'

describe('steam-accounts-shop', () => {
  it('lists the four launch products', () => {
    expect(STEAM_ACCOUNT_PRODUCTS.map((p) => p.id)).toEqual([
      'rust',
      'assassins-creed-odyssey',
      'phasmophobia',
      'planet-zoo',
    ])
  })

  it('formats USD prices', () => {
    expect(formatProductPrice(9.99)).toMatch(/\$9\.99/)
  })

  it('resolves products by id', () => {
    expect(getSteamAccountProduct('rust')?.steamAppId).toBe(252490)
  })

  it('marks products unavailable when Pandabase product env is unset', () => {
    const products = getPublicSteamAccountProducts()
    expect(products).toHaveLength(4)
    expect(products.every((p) => p.available === false)).toBe(true)
  })
})
