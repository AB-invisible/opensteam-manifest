import { prisma } from './prisma'

export const HOSTED_GEN_SOURCE_BRANDED = 'discord-hosted'
export const HOSTED_GEN_SOURCE_CUSTOM = 'discord-hosted-api'

export function getHostedGenSource(useApiLimit: boolean): string {
  return useApiLimit ? HOSTED_GEN_SOURCE_CUSTOM : HOSTED_GEN_SOURCE_BRANDED
}

function utcDayBounds() {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setUTCHours(23, 59, 59, 999)
  return { todayStart, todayEnd }
}

/** Per-server hosted bot usage — isolated by instance, not pooled across guilds. */
export async function countHostedBotUsageToday(
  hostedBotInstanceId: string,
  source: string
): Promise<number> {
  const { todayStart, todayEnd } = utcDayBounds()
  return prisma.webGeneration.count({
    where: {
      hostedBotInstanceId,
      source,
      createdAt: { gte: todayStart, lte: todayEnd },
    },
  })
}

/** Account-wide API usage today — matches checkDailyApiQuota (non-429). */
export async function countUserApiUsageToday(userId: string): Promise<number> {
  const { todayStart, todayEnd } = utcDayBounds()
  return prisma.apiUsage.count({
    where: {
      apiKey: { userId },
      createdAt: { gte: todayStart, lte: todayEnd },
      status: { not: 429 },
    },
  })
}

export async function recordHostedBotGeneration(input: {
  purchaserUserId: string
  hostedBotInstanceId: string
  guildId: string
  appId: string
  gameName: string
  source: string
}) {
  return prisma.webGeneration.create({
    data: {
      userId: input.purchaserUserId,
      hostedBotInstanceId: input.hostedBotInstanceId,
      guildId: input.guildId,
      appId: input.appId,
      gameName: input.gameName,
      source: input.source,
    },
  })
}
