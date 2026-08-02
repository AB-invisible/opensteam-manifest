import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'

export const dynamic = 'force-dynamic'

function normalizeSnowflake(raw: unknown): string {
  return String(raw ?? '').trim()
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId },
  })
  if (!user || !['ADMIN', 'OWNER'].includes(user.role)) return null
  return user
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [friends, guilds] = await Promise.all([
      prisma.verificationFriendBlacklist.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.verificationGuildBlacklist.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ])

    return NextResponse.json({ friends, guilds })
  } catch (error) {
    console.error('[Verify Blacklist] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load verification blacklist.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const kind = body.kind === 'friend' || body.kind === 'guild' ? body.kind : null
    const reason = String(body.reason || '').trim()
    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const guildName = typeof body.guildName === 'string' ? body.guildName.trim() : ''

    if (!kind || !reason) {
      return NextResponse.json({ error: 'kind and reason are required.' }, { status: 400 })
    }

    if (kind === 'friend') {
      const discordId = normalizeSnowflake(body.discordId)
      if (!/^\d{5,32}$/.test(discordId)) {
        return NextResponse.json({ error: 'A numeric discordId is required.' }, { status: 400 })
      }

      const row = await prisma.verificationFriendBlacklist.upsert({
        where: { discordId },
        update: { reason, label: label || null },
        create: {
          discordId,
          reason,
          label: label || null,
          addedById: user.id,
        },
      })
      return NextResponse.json({ success: true, entry: row })
    }

    const guildId = normalizeSnowflake(body.guildId)
    if (!/^\d{5,32}$/.test(guildId)) {
      return NextResponse.json({ error: 'A numeric guildId is required.' }, { status: 400 })
    }

    const row = await prisma.verificationGuildBlacklist.upsert({
      where: { guildId },
      update: { reason, guildName: guildName || null },
      create: {
        guildId,
        guildName: guildName || null,
        reason,
        addedById: user.id,
      },
    })

    return NextResponse.json({ success: true, entry: row })
  } catch (error) {
    console.error('[Verify Blacklist] POST failed:', error)
    return NextResponse.json({ error: 'Failed to save verification blacklist entry.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const kind = body.kind === 'friend' || body.kind === 'guild' ? body.kind : null

    if (kind === 'friend') {
      const discordId = normalizeSnowflake(body.discordId)
      await prisma.verificationFriendBlacklist.deleteMany({ where: { discordId } })
      return NextResponse.json({ success: true })
    }

    if (kind === 'guild') {
      const guildId = normalizeSnowflake(body.guildId)
      await prisma.verificationGuildBlacklist.deleteMany({ where: { guildId } })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'kind must be friend or guild.' }, { status: 400 })
  } catch (error) {
    console.error('[Verify Blacklist] DELETE failed:', error)
    return NextResponse.json({ error: 'Failed to remove verification blacklist entry.' }, { status: 500 })
  }
}
