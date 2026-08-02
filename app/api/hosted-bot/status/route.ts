import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getHostedGenDailyLimit, getHostedBotTypeForPlan, isHostedBotPlanActive, getHostedBotAllowedCommands } from '@/app/lib/hosted-bot-plans'
import {
  ensureHostedInstanceForSessionUser,
  getBrandedBotConfig,
  serializeHostedBotInstance,
} from '@/app/lib/hosted-bot'
import { countHostedBotUsageToday, countUserApiUsageToday, getHostedGenSource } from '@/app/lib/hosted-bot-usage'

async function getAuthedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  return prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
}

export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const botType = getHostedBotTypeForPlan(user.plan)
  const instance =
    botType != null
      ? (await ensureHostedInstanceForSessionUser(user)) ??
        (await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } }))
      : await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } })

  const useApiLimit = botType === 'CUSTOM'
  const genSource = getHostedGenSource(useApiLimit)

  const todayCount = useApiLimit
    ? await countUserApiUsageToday(user.id)
    : instance
      ? await countHostedBotUsageToday(instance.id, genSource)
      : 0

  const dailyLimit = botType
    ? getHostedGenDailyLimit(user, useApiLimit)
    : 0

  const brandedConfig = await getBrandedBotConfig()
  const customManagerCfg = await prisma.systemConfig.findUnique({
    where: { key: 'HOSTED_CUSTOM_MANAGER_ENABLED' },
  })

  return NextResponse.json({
    plan: user.plan,
    planActive: isHostedBotPlanActive(user),
    planExpiry: user.planExpiry,
    botType,
    instance: instance ? serializeHostedBotInstance(instance, { includeClientId: botType === 'CUSTOM' }) : null,
    usage: {
      todayCount,
      dailyLimit,
      source: genSource,
      scopedToInstance: !!instance?.guildId,
      linkedGuildId: instance?.guildId ?? null,
      linkedUserId: user.id,
    },
    daemon: {
      brandedEnabled: brandedConfig.enabled,
      brandedConfigured: brandedConfig.hasBotToken && brandedConfig.hasClientId,
      customManagerEnabled: customManagerCfg?.value === 'true',
    },
    allowedCommands: botType ? getHostedBotAllowedCommands(user.plan) : [],
  })
}
