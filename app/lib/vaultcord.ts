import { prisma } from '@/app/lib/prisma'
import {
  VaultCordBuyResult,
  VaultCordMarketFilter,
  VaultCordMarketSeller,
  buildUniqueBuyerEmail,
  parseDiscordInviteCode,
} from '@/app/lib/vaultcord-shared'

export type { VaultCordBuyResult, VaultCordMarketFilter, VaultCordMarketSeller } from '@/app/lib/vaultcord-shared'
export { buildUniqueBuyerEmail, formatCents, parseDiscordInviteCode, resolveSellerMarketId } from '@/app/lib/vaultcord-shared'

const VAULTCORD_API_BASE = 'https://api.vaultcord.com'

type VaultCordResponse<T> = {
  success?: boolean
  message?: string
  data?: T
}

export class VaultCordApiError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'VaultCordApiError'
    this.status = status
  }
}

export async function getVaultCordApiKey(): Promise<string | null> {
  const envKey = process.env.VAULTCORD_API_KEY?.trim()
  if (envKey) return envKey

  const row = await prisma.systemConfig.findUnique({ where: { key: 'VAULTCORD_API_KEY' } })
  return row?.value?.trim() || null
}

async function vaultCordRequest<T>(
  path: string,
  init: RequestInit & { apiKey: string }
): Promise<T> {
  const { apiKey, ...fetchInit } = init
  const response = await fetch(`${VAULTCORD_API_BASE}${path}`, {
    ...fetchInit,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(fetchInit.body ? { 'Content-Type': 'application/json' } : {}),
      ...(fetchInit.headers || {}),
    },
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as VaultCordResponse<T> & Record<string, unknown>

  if (!response.ok) {
    const message =
      (typeof payload.message === 'string' && payload.message) ||
      `VaultCord API error (${response.status})`
    throw new VaultCordApiError(message, response.status)
  }

  if (payload.success === false) {
    throw new VaultCordApiError(
      typeof payload.message === 'string' ? payload.message : 'VaultCord request failed',
      response.status
    )
  }

  return (payload.data ?? payload) as T
}

export async function fetchVaultCordMarketplace(
  filter?: VaultCordMarketFilter
): Promise<VaultCordMarketSeller[]> {
  const apiKey = await getVaultCordApiKey()
  if (!apiKey) throw new VaultCordApiError('VaultCord API key is not configured', 400)

  const query = filter ? `?filter=${encodeURIComponent(filter)}` : ''
  const data = await vaultCordRequest<VaultCordMarketSeller[] | { sellers?: VaultCordMarketSeller[] }>(
    `/market/fetch${query}`,
    { apiKey, method: 'GET' }
  )

  if (Array.isArray(data)) return data
  if (Array.isArray(data.sellers)) return data.sellers
  return []
}

export async function buyVaultCordMembers(input: {
  marketId: number
  inviteLink: string
  userEmail: string
  amount: number
  budget?: number
}): Promise<VaultCordBuyResult> {
  const apiKey = await getVaultCordApiKey()
  if (!apiKey) throw new VaultCordApiError('VaultCord API key is not configured', 400)

  return vaultCordRequest<VaultCordBuyResult>('/market/buy', {
    apiKey,
    method: 'POST',
    body: JSON.stringify({
      marketId: input.marketId,
      inviteLink: parseDiscordInviteCode(input.inviteLink),
      userEmail: input.userEmail,
      amount: input.amount,
      ...(input.budget != null ? { budget: input.budget } : {}),
    }),
  })
}

export async function pullVaultCordMarketOrder(orderId: string): Promise<{ message?: string }> {
  const apiKey = await getVaultCordApiKey()
  if (!apiKey) throw new VaultCordApiError('VaultCord API key is not configured', 400)

  return vaultCordRequest<{ message?: string }>('/market/pull', {
    apiKey,
    method: 'POST',
    body: JSON.stringify({ orderId }),
  })
}

export async function refundVaultCordMarketOrder(orderId: string): Promise<{ message?: string }> {
  const apiKey = await getVaultCordApiKey()
  if (!apiKey) throw new VaultCordApiError('VaultCord API key is not configured', 400)

  return vaultCordRequest<{ message?: string }>(`/market/refund/${encodeURIComponent(orderId)}`, {
    apiKey,
    method: 'POST',
  })
}

export async function updateVaultCordMarketInvite(input: {
  ref: string
  invite: string
}): Promise<{ message?: string }> {
  const apiKey = await getVaultCordApiKey()
  if (!apiKey) throw new VaultCordApiError('VaultCord API key is not configured', 400)

  return vaultCordRequest<{ message?: string }>('/market/update-invite', {
    apiKey,
    method: 'POST',
    body: JSON.stringify({
      ref: input.ref,
      invite: parseDiscordInviteCode(input.invite),
    }),
  })
}
