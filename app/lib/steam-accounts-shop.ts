/** External storefront (SellAuth) — used while Pandabase shop checkout is unavailable. */
export const STEAM_ACCOUNT_SHOP_URL = 'https://opensteam.mysellauth.com/'

export type SteamAccountProduct = {
  id: string
  name: string
  description: string
  priceUsd: number
  steamAppId: number
  /** Env var holding the Pandabase product ID for this one-time product. */
  pandabaseProductEnvKey: string
}

/** Steam account products — one Pandabase product per game, prices editable here. */
export const STEAM_ACCOUNT_PRODUCTS: SteamAccountProduct[] = [
  {
    id: 'rust',
    name: 'Rust',
    description: 'Dedicated Steam account with Rust. Login credentials delivered after purchase.',
    priceUsd: 9.99,
    steamAppId: 252490,
    pandabaseProductEnvKey: 'PANDABASE_PRODUCT_ACCOUNT_RUST',
  },
  {
    id: 'assassins-creed-odyssey',
    name: "Assassin's Creed Odyssey",
    description: 'Dedicated Steam account with Assassin\'s Creed Odyssey. Login credentials delivered after purchase.',
    priceUsd: 7.99,
    steamAppId: 812140,
    pandabaseProductEnvKey: 'PANDABASE_PRODUCT_ACCOUNT_AC_ODYSSEY',
  },
  {
    id: 'phasmophobia',
    name: 'Phasmophobia',
    description: 'Dedicated Steam account with Phasmophobia. Login credentials delivered after purchase.',
    priceUsd: 5.99,
    steamAppId: 739630,
    pandabaseProductEnvKey: 'PANDABASE_PRODUCT_ACCOUNT_PHASMOPHOBIA',
  },
  {
    id: 'planet-zoo',
    name: 'Planet Zoo',
    description: 'Dedicated Steam account with Planet Zoo. Login credentials delivered after purchase.',
    priceUsd: 6.99,
    steamAppId: 703080,
    pandabaseProductEnvKey: 'PANDABASE_PRODUCT_ACCOUNT_PLANET_ZOO',
  },
]

export function getSteamAccountProduct(productId: string): SteamAccountProduct | undefined {
  return STEAM_ACCOUNT_PRODUCTS.find((p) => p.id === productId)
}

export function getPandabaseProductIdForProduct(productId: string): string | null {
  const product = getSteamAccountProduct(productId)
  if (!product) return null
  const pandabaseProductId = process.env[product.pandabaseProductEnvKey]?.trim()
  return pandabaseProductId || null
}

export function formatProductPrice(priceUsd: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(priceUsd)
}

export function steamHeaderImageUrl(steamAppId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`
}

export type PublicSteamAccountProduct = {
  id: string
  name: string
  description: string
  priceDisplay: string
  priceUsd: number
  steamAppId: number
  imageUrl: string
  available: boolean
}

export function getPublicSteamAccountProducts(): PublicSteamAccountProduct[] {
  return STEAM_ACCOUNT_PRODUCTS.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    priceDisplay: formatProductPrice(product.priceUsd),
    priceUsd: product.priceUsd,
    steamAppId: product.steamAppId,
    imageUrl: steamHeaderImageUrl(product.steamAppId),
    available: Boolean(getPandabaseProductIdForProduct(product.id)),
  }))
}
