import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { HostedBotType, Prisma } from '@prisma/client'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
  if (!user || user.role !== 'OWNER') return null
  return user
}

const MAX_LIMIT = 200

export async function GET(req: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const instanceId = searchParams.get('instanceId')
  const scopeParam = searchParams.get('scope')
  const after = searchParams.get('after')
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit')) || 100))

  const where: Prisma.HostedBotLogWhereInput = {}
  if (instanceId) {
    where.instanceId = instanceId
  } else if (scopeParam && (scopeParam === 'BRANDED' || scopeParam === 'CUSTOM')) {
    where.scope = scopeParam as HostedBotType
  }
  if (after) {
    const afterDate = new Date(after)
    if (!Number.isNaN(afterDate.getTime())) where.createdAt = { gt: afterDate }
  }

  try {
    const logs = await prisma.hostedBotLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    // Return chronological (oldest first) for console rendering.
    return NextResponse.json({ logs: logs.reverse() })
  } catch (e: any) {
    const message = String(e?.message || e)
    const needsMigration = message.includes('hosted_bot_logs') || message.includes('does not exist')
    return NextResponse.json(
      {
        error: needsMigration
          ? 'Hosted bot log table is missing. Run prisma migrate deploy on the server.'
          : 'Failed to load hosted bot logs',
        logs: [],
      },
      { status: needsMigration ? 503 : 500 }
    )
  }
}
