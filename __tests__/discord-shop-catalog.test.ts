import { describe, expect, it } from 'vitest'

const {
  SHOP_COINRAIN_AMOUNT,
  SHOP_ITEMS,
  getShopItem,
  shopCommandChoices,
  shopEmbedFields,
  shopPricing,
} = require('../scripts/lib/shop-catalog')

describe('discord shop catalog', () => {
  it('includes the expanded shop perks', () => {
    expect(getShopItem('spotlight')?.cost).toBe(1200)
    expect(getShopItem('coinrain')?.cost).toBe(2200)
    expect(getShopItem('thread')?.cost).toBe(1800)
    expect(getShopItem('vip')?.cost).toBe(4000)
    expect(SHOP_COINRAIN_AMOUNT).toBe(500)
  })

  it('keeps command choices valid for Discord slash commands', () => {
    const choices = shopCommandChoices()
    const values = new Set(choices.map((choice: { value: string }) => choice.value))

    expect(choices).toHaveLength(SHOP_ITEMS.length)
    expect(values.size).toBe(SHOP_ITEMS.length)
    for (const choice of choices) {
      expect(choice.name.length).toBeLessThanOrEqual(100)
      expect(choice.value.length).toBeLessThanOrEqual(100)
    }
  })

  it('keeps prices and shop display in sync with catalog items', () => {
    const pricing = shopPricing()
    const fields = shopEmbedFields()

    for (const item of SHOP_ITEMS) {
      expect(pricing[item.id]).toBe(item.cost)
      expect(fields.some((field: { name: string }) => field.name.includes(`\`${item.id}\``))).toBe(true)
    }
  })
})
