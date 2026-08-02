import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getSteamAccountProduct } from '@/app/lib/steam-accounts-shop'

export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orders = await prisma.steamAccountOrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({
    orders: orders.map((order) => {
      const product = getSteamAccountProduct(order.productId)
      return {
        id: order.id,
        productId: order.productId,
        productName: product?.name ?? order.productId,
        status: order.status,
        deliveryError: order.deliveryError,
        deliveredAt: order.deliveredAt,
        createdAt: order.createdAt,
        hasCredentials: order.status === 'DELIVERED' && Boolean(order.deliveryPayload),
        credentials:
          order.status === 'DELIVERED' && order.deliveryPayload
            ? order.deliveryPayload
            : null,
      }
    }),
  })
}
