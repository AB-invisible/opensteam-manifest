import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import {
  VaultCordApiError,
  VaultCordMarketFilter,
  fetchVaultCordMarketplace,
  getVaultCordApiKey,
  pullVaultCordMarketOrder,
  refundVaultCordMarketOrder,
  resolveSellerMarketId,
  updateVaultCordMarketInvite,
} from '@/app/lib/vaultcord'
import { placeMemberMarketOrder } from '@/app/lib/members-shop-service'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
  })
  if (!user || user.role !== 'OWNER') return null
  return user
}

function parseFilter(value: unknown): VaultCordMarketFilter | undefined {
  const allowed: VaultCordMarketFilter[] = ['price-low', 'price-high', 'newest', 'most-members']
  return typeof value === 'string' && allowed.includes(value as VaultCordMarketFilter)
    ? (value as VaultCordMarketFilter)
    : undefined
}

export async function GET(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const filter = parseFilter(searchParams.get('filter'))
  const apiKey = await getVaultCordApiKey()

  const [orders, sellers] = await Promise.all([
    prisma.memberMarketOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        createdBy: { select: { username: true, discordId: true } },
      },
    }),
    apiKey
      ? fetchVaultCordMarketplace(filter).catch((error) => {
          console.error('[members-shop] fetch sellers failed:', error)
          return []
        })
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    configured: !!apiKey,
    filter: filter || null,
    sellers,
    orders,
  })
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : ''

  try {
    if (action === 'save-api-key') {
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (!apiKey) {
        return NextResponse.json({ error: 'API key is required' }, { status: 400 })
      }

      await prisma.systemConfig.upsert({
        where: { key: 'VAULTCORD_API_KEY' },
        update: { value: apiKey, isSecret: true },
        create: { key: 'VAULTCORD_API_KEY', value: apiKey, isSecret: true },
      })

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'UPDATE_CONFIG',
          targetId: 'VAULTCORD_API_KEY',
          details: 'Updated VaultCord API key for members shop',
          ip: request.headers.get('x-forwarded-for') || 'admin-dashboard',
        },
      })

      return NextResponse.json({ success: true, configured: true })
    }

    if (action === 'buy') {
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

      const { order, vault: result } = await placeMemberMarketOrder(
        owner,
        {
          marketId,
          inviteLink,
          amount,
          budget: budget != null && Number.isFinite(budget) ? budget : undefined,
          sellerTitle,
          sellerServer,
        },
        request.headers.get('x-forwarded-for') || 'admin-dashboard'
      )

      return NextResponse.json({
        success: true,
        order,
        vault: result,
        message: 'Order placed successfully. Pull the order to start member delivery.',
      })
    }

    if (action === 'pull') {
      const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
      if (!orderId) {
        return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
      }

      const result = await pullVaultCordMarketOrder(orderId)
      const existing = await prisma.memberMarketOrder.findUnique({
        where: { vaultOrderId: orderId },
      })
      const order = existing
        ? await prisma.memberMarketOrder.update({
            where: { vaultOrderId: orderId },
            data: {
              status: 'pulled',
              pulledAt: new Date(),
            },
            include: {
              createdBy: { select: { username: true, discordId: true } },
            },
          })
        : null

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'MEMBERS_SHOP_PULL',
          targetId: order?.id || orderId,
          details: { vaultOrderId: orderId, message: result.message || null },
          ip: request.headers.get('x-forwarded-for') || 'admin-dashboard',
        },
      })

      return NextResponse.json({
        success: true,
        order,
        message: result.message || 'Successfully started member pull.',
      })
    }

    if (action === 'refund') {
      const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
      if (!orderId) {
        return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
      }

      const result = await refundVaultCordMarketOrder(orderId)
      const existing = await prisma.memberMarketOrder.findUnique({
        where: { vaultOrderId: orderId },
      })
      const order = existing
        ? await prisma.memberMarketOrder.update({
            where: { vaultOrderId: orderId },
            data: {
              status: 'refunded',
              refundedAt: new Date(),
            },
            include: {
              createdBy: { select: { username: true, discordId: true } },
            },
          })
        : null

      await prisma.auditLog.create({
        data: {
          userId: owner.id,
          action: 'MEMBERS_SHOP_REFUND',
          targetId: order?.id || orderId,
          details: { vaultOrderId: orderId, message: result.message || null },
          ip: request.headers.get('x-forwarded-for') || 'admin-dashboard',
        },
      })

      return NextResponse.json({
        success: true,
        order,
        message: result.message || 'Refund request submitted.',
      })
    }

    if (action === 'update-invite') {
      const ref = typeof body.ref === 'string' ? body.ref.trim() : ''
      const invite = typeof body.invite === 'string' ? body.invite.trim() : ''
      if (!ref || !invite) {
        return NextResponse.json({ error: 'ref and invite are required' }, { status: 400 })
      }

      const result = await updateVaultCordMarketInvite({ ref, invite })

      const order = await prisma.memberMarketOrder.findFirst({
        where: { reference: ref },
      })
      if (order) {
        await prisma.memberMarketOrder.update({
          where: { id: order.id },
          data: { inviteCode: invite },
        })
      }

      return NextResponse.json({
        success: true,
        message: result.message || 'Invite code updated.',
      })
    }

    if (action === 'validate-sellers') {
      const sellers = await fetchVaultCordMarketplace(parseFilter(body.filter))
      const normalized = sellers.map((seller) => ({
        ...seller,
        marketId: resolveSellerMarketId(seller),
      }))
      return NextResponse.json({ sellers: normalized })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    if (error instanceof VaultCordApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[admin/members-shop]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Members shop request failed' },
      { status: 500 }
    )
  }
}
