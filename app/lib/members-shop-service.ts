import { prisma } from '@/app/lib/prisma'
import {
  VaultCordApiError,
  buildUniqueBuyerEmail,
  buyVaultCordMembers,
} from '@/app/lib/vaultcord'
import type { User } from '@prisma/client'

export type PlaceMemberMarketOrderInput = {
  marketId: number
  inviteLink: string
  amount: number
  budget?: number
  sellerTitle?: string
  sellerServer?: string
}

export async function placeMemberMarketOrder(
  actor: User,
  input: PlaceMemberMarketOrderInput,
  auditIp: string
) {
  const buyerEmail = buildUniqueBuyerEmail(actor.id)
  const result = await buyVaultCordMembers({
    marketId: input.marketId,
    inviteLink: input.inviteLink,
    userEmail: buyerEmail,
    amount: input.amount,
    budget: input.budget,
  })

  if (!result.orderId) {
    throw new VaultCordApiError('VaultCord did not return an order ID', 502)
  }

  const order = await prisma.memberMarketOrder.create({
    data: {
      vaultOrderId: result.orderId,
      reference: result.reference || null,
      marketId: input.marketId,
      amount: result.amount ?? input.amount,
      costCents: result.cost ?? null,
      inviteCode: result.inviteCode || input.inviteLink,
      guildId: result.guildId || null,
      buyerEmail: result.userEmail || buyerEmail,
      status: result.status || 'paid',
      sellerTitle: input.sellerTitle || null,
      sellerServer: input.sellerServer || null,
      inviteUrl: result.inviteUrl || null,
      orderUrl: result.url || null,
      newBalanceCents: result.newBalance ?? null,
      createdById: actor.id,
    },
    include: {
      createdBy: { select: { username: true, discordId: true } },
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: 'MEMBERS_SHOP_BUY',
      targetId: order.id,
      details: {
        vaultOrderId: order.vaultOrderId,
        marketId: input.marketId,
        amount: order.amount,
        costCents: order.costCents,
        inviteCode: order.inviteCode,
      },
      ip: auditIp,
    },
  })

  return { order, vault: result }
}
