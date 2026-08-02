import { authOptions } from '@/app/lib/auth-options'
import { runDiscordPullback } from '@/app/lib/discord-oauth-tokens'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
  })
  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) return null
  return user
}

function formatPullbackMessage(result: {
  total: number
  joined: number
  alreadyMember: number
  expired: number
  failed: number
  failureSamples: string[]
  targetUser?: { username: string; discordId: string } | null
}) {
  if (result.total === 1 && result.targetUser) {
    const label = result.targetUser.username || result.targetUser.discordId
    if (result.joined === 1) return `${label} was added to the server.`
    if (result.alreadyMember === 1) return `${label} is already in the server.`
    if (result.expired === 1) {
      return `${label} has expired or missing OAuth tokens. They must sign in to OpenSteam again.`
    }
    if (result.failed === 1 && result.failureSamples[0]) {
      return `Failed to pull back ${label}: ${result.failureSamples[0]}`
    }
  }

  const parts = [
    `Processed ${result.total}`,
    `${result.joined} joined`,
    `${result.alreadyMember} already in server`,
    `${result.expired} expired/no token`,
    `${result.failed} failed`,
  ]
  return parts.join(' · ')
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const rawUserId = body.userId != null ? String(body.userId).trim() : ''
  const userId = rawUserId.replace(/[<@!>]/g, '').trim() || undefined

  try {
    const result = await runDiscordPullback({ userId })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'DISCORD_PULLBACK',
        details: JSON.stringify({
          targetUserId: userId || 'all',
          total: result.total,
          joined: result.joined,
          alreadyMember: result.alreadyMember,
          expired: result.expired,
          failed: result.failed,
          failureSamples: result.failureSamples,
          targetUser: result.targetUser
            ? {
                id: result.targetUser.id,
                username: result.targetUser.username,
                discordId: result.targetUser.discordId,
              }
            : null,
        }),
        ip: request.headers.get('x-forwarded-for') || 'admin-dashboard',
      },
    })

    return NextResponse.json({
      success: true,
      message: formatPullbackMessage(result),
      total: result.total,
      joined: result.joined,
      alreadyMember: result.alreadyMember,
      expired: result.expired,
      failed: result.failed,
      failureSamples: result.failureSamples,
      targetUser: result.targetUser,
    })
  } catch (error: any) {
    console.error('[admin/bot/pullback]', error)
    return NextResponse.json({ error: error.message || 'Pullback failed' }, { status: 500 })
  }
}
