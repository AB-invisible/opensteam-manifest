import { requireAuth } from '@/app/lib/auth-helpers'
import { assertDiscordGuildAccess } from '@/app/lib/discord-guild-restrictions'
import { placeMemberMarketOrder } from '@/app/lib/members-shop-service'
import {
  VaultCordApiError,
  VaultCordMarketFilter,
  fetchVaultCordMarketplace,
  getVaultCordApiKey,
} from '@/app/lib/vaultcord'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function parseFilter(value: unknown): VaultCordMarketFilter | undefined {
  const allowed: VaultCordMarketFilter[] = ['price-low', 'price-high', 'newest', 'most-members']
  return typeof value === 'string' && allowed.includes(value as VaultCordMarketFilter)
    ? (value as VaultCordMarketFilter)
    : undefined
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.error

  const { dbUser } = auth.data
  if (dbUser.isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const filter = parseFilter(searchParams.get('filter'))
  const apiKey = await getVaultCordApiKey()

  const sellers = apiKey
    ? await fetchVaultCordMarketplace(filter).catch((error) => {
        console.error('[members-shop] fetch sellers failed:', error)
        return []
      })
    : []

  return NextResponse.json({
    available: !!apiKey,
    filter: filter || null,
    sellers,
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.error

  const { dbUser } = auth.data
  if (dbUser.isBanned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guildAccess = assertDiscordGuildAccess(dbUser)
  if (!guildAccess.ok) {
    return NextResponse.json({ error: guildAccess.error, code: guildAccess.code }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  if (body.action !== 'buy') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const marketId = Number(body.marketId)
  const amount = Number(body.amount)
  const inviteLink = typeof body.inviteLink === 'string' ? body.inviteLink.trim() : ''
  const budget = body.budget != null && body.budget !== '' ? Number(body.budget) : undefined
  const sellerTitle = typeof body.sellerTitle === 'string' ? body.sellerTitle : undefined
  const sellerServer = typeof body.sellerServer === 'string' ? body.sellerServer : undefined

  if (!Number.isFinite(marketId) || marketId <= 0) {
    return NextResponse.json({ error: 'Valid marketId is required' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 })
  }
  if (!inviteLink) {
    return NextResponse.json({ error: 'Discord invite link is required' }, { status: 400 })
  }

  try {
    const { order, vault } = await placeMemberMarketOrder(
      dbUser,
      {
        marketId,
        inviteLink,
        amount,
        budget: budget != null && Number.isFinite(budget) ? budget : undefined,
        sellerTitle,
        sellerServer,
      },
      request.headers.get('x-forwarded-for') || 'members-shop'
    )

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        vaultOrderId: order.vaultOrderId,
        amount: order.amount,
        status: order.status,
        inviteUrl: order.inviteUrl,
        orderUrl: order.orderUrl,
      },
      vault,
      message:
        'Order placed successfully. Staff will start delivery once the order is pulled on your server.',
    })
  } catch (error) {
    if (error instanceof VaultCordApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[api/members-shop]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Members shop request failed' },
      { status: 500 }
    )
  }
}
