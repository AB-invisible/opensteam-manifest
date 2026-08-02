import { prisma } from '@/app/lib/prisma'
import { getSteamAccountProduct } from '@/app/lib/steam-accounts-shop'

/**
 * Fulfill a paid Steam account order.
 * External account-delivery API integration will be wired here later.
 */
export async function fulfillSteamAccountOrder(orderId: string): Promise<void> {
  const order = await prisma.steamAccountOrder.findUnique({ where: { id: orderId } })
  if (!order || order.status === 'DELIVERED' || order.status === 'REFUNDED') return

  const product = getSteamAccountProduct(order.productId)
  if (!product) {
    await prisma.steamAccountOrder.update({
      where: { id: orderId },
      data: { status: 'FAILED', deliveryError: 'Unknown product.' },
    })
    return
  }

  await prisma.steamAccountOrder.update({
    where: { id: orderId },
    data: { status: 'DELIVERING' },
  })

  // TODO: call external account delivery API when configured.
  const deliveryApiUrl = process.env.STEAM_ACCOUNT_DELIVERY_API_URL?.trim()
  if (!deliveryApiUrl) {
    await prisma.steamAccountOrder.update({
      where: { id: orderId },
      data: {
        status: 'PAID',
        deliveryError: 'Automatic delivery is not configured yet. Support will fulfill your order manually.',
      },
    })
    return
  }

  try {
    // Placeholder for future external API integration.
    throw new Error('External delivery API integration pending.')
  } catch (err: any) {
    await prisma.steamAccountOrder.update({
      where: { id: orderId },
      data: {
        status: 'FAILED',
        deliveryError: err?.message || 'Delivery failed.',
      },
    })
    throw err
  }
}
