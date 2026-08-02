export type VaultCordMarketFilter = 'price-low' | 'price-high' | 'newest' | 'most-members'

export type VaultCordMarketSeller = {
  id?: number
  marketId?: number
  serverName?: string
  title?: string
  cost?: number
  numOrders?: number
  category?: string
  minAmount?: number
  memberCount?: number
}

export type VaultCordBuyResult = {
  newBalance?: number
  url?: string
  inviteUrl?: string
  reference?: string
  orderId?: string
  amount?: number
  guildId?: string
  inviteCode?: string
  userEmail?: string
  status?: string
  clientId?: string
  cost?: number
  created_at?: number | string
}

export function parseDiscordInviteCode(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/(?:discord\.gg\/|discord\.com\/invite\/)([a-zA-Z0-9-]+)/i)
  if (match?.[1]) return match[1]
  return trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^discord\.gg\//i, '')
    .replace(/^discord\.com\/invite\//i, '')
    .replace(/\/$/, '')
}

export function formatCents(cents?: number | null): string {
  if (cents == null || Number.isNaN(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

export function resolveSellerMarketId(seller: VaultCordMarketSeller): number | null {
  const id = seller.marketId ?? seller.id
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

export function buildUniqueBuyerEmail(userId: string, suffix?: string): string {
  const stamp = suffix || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `members+${userId}+${stamp}@opensteam.lol`
}
