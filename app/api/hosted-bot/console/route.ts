import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { Prisma } from '@prisma/client'

async function getAuthedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  return prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
}

const HEARTBEAT_FRESH_MS = 90_000
const MAX_LIMIT = 150

export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const instance = await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } })
  if (!instance) {
    return NextResponse.json({ instance: null, logs: [] })
  }

  const { searchParams } = new URL(req.url)
  const after = searchParams.get('after')
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit')) || 80))

  // A user only ever sees logs tied to their own instance (custom bots, and
  // branded events that the daemon tagged with this instance id).
  const where: Prisma.HostedBotLogWhereInput = { instanceId: instance.id }
  if (after) {
    const afterDate = new Date(after)
    if (!Number.isNaN(afterDate.getTime())) where.createdAt = { gt: afterDate }
  }

  let logs: any[] = []
  try {
    const rows = await prisma.hostedBotLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    logs = rows.reverse()
  } catch (e) {
    logs = []
  }

  const heartbeatFresh =
    !!instance.lastHeartbeatAt &&
    Date.now() - new Date(instance.lastHeartbeatAt).getTime() < HEARTBEAT_FRESH_MS

  return NextResponse.json({
    instance: {
      id: instance.id,
      type: instance.type,
      status: instance.status,
      guildId: instance.guildId,
      guildName: instance.guildName,
      guildOwnerName: instance.guildOwnerName,
      memberCount: instance.memberCount,
      botUsername: instance.botUsername,
      inviteUrl: instance.inviteUrl,
      connectedAt: instance.connectedAt,
      lastHeartbeatAt: instance.lastHeartbeatAt,
      liveConnected: heartbeatFresh,
    },
    logs: logs.map((l) => ({
      id: l.id,
      level: l.level,
      source: l.source,
      message: l.message,
      createdAt: l.createdAt,
    })),
  })
}
