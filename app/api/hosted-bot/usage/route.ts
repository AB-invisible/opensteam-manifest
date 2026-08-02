import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getHostedBotTypeForPlan } from '@/app/lib/hosted-bot-plans'
import { ensureHostedInstanceForSessionUser } from '@/app/lib/hosted-bot'
import { getHostedGenSource } from '@/app/lib/hosted-bot-usage'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const botType = getHostedBotTypeForPlan(user.plan)
  const instance =
    botType != null
      ? (await ensureHostedInstanceForSessionUser(user)) ??
        (await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } }))
      : await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } })

  if (!instance) {
    return NextResponse.json({ daily: [], total7d: 0, errors7d: 0 })
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const source = getHostedGenSource(botType === 'CUSTOM')

  const generations = await prisma.webGeneration.findMany({
    where: {
      hostedBotInstanceId: instance.id,
      source,
      createdAt: { gte: since },
    },
    select: { createdAt: true, appId: true, gameName: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const dailyMap = new Map<string, number>()
  for (const g of generations) {
    const day = g.createdAt.toISOString().slice(0, 10)
    dailyMap.set(day, (dailyMap.get(day) || 0) + 1)
  }

  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  return NextResponse.json({
    instance: {
      id: instance.id,
      status: instance.status,
      guildId: instance.guildId,
      updatedAt: instance.updatedAt,
    },
    daily,
    total7d: generations.length,
    recent: generations.slice(0, 10),
  })
}
