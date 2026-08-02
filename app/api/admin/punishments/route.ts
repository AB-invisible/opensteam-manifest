import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId },
  })

  if (!user || !['TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await prisma.punishment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const punishments = rows.map((p) => ({
    ...p,
    target: {
      username: p.username || 'Unknown User',
      discordId: p.discordId || '',
    },
    issuedBy: {
      username: p.moderatorName || 'Unknown Moderator',
      role: 'STAFF',
      discordId: p.moderatorId || '',
    },
    proof: p.proofUrl || '',
    description: p.reason || '',
  }))

  return NextResponse.json({ punishments })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user || !['TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const username = body.username
    const discordId = body.discordId
    const type = body.type
    const proofUrl = body.proofUrl ?? body.proof ?? null
    const reason = body.reason ?? body.description

    if (!username || !discordId || !type || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const targetUserDb = await prisma.user.findUnique({ where: { discordId } })

    const punishment = await prisma.punishment.create({
      data: {
        userId: targetUserDb ? targetUserDb.id : null,
        discordId,
        username,
        moderatorId: user.discordId,
        moderatorName: user.username,
        type,
        reason,
        duration: body.duration || null,
        proofUrl: proofUrl || null
      }
    })

    // Log audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PUNISHMENT_CREATE',
        targetId: discordId,
        details: {
          punishmentId: punishment.id,
          type,
          reason
        }
      }
    })

    return NextResponse.json({ success: true, punishment })
  } catch (error: any) {
    console.error('[Punishment Creation Error]', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  // EDIT IS STRICTLY FOR OWNER ROLE!
  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden: Owner role required' }, { status: 403 })
  }

  try {
    const { punishmentId, username, discordId, type, proofUrl, reason, duration } = await request.json()

    if (!punishmentId) {
      return NextResponse.json({ error: 'Missing punishment ID' }, { status: 400 })
    }

    const targetUserDb = discordId ? await prisma.user.findUnique({ where: { discordId } }) : null

    const updated = await prisma.punishment.update({
      where: { id: punishmentId },
      data: {
        ...(username && { username }),
        ...(discordId && { discordId, userId: targetUserDb ? targetUserDb.id : null }),
        ...(type && { type }),
        ...(proofUrl !== undefined && { proofUrl }),
        ...(reason && { reason }),
        ...(duration !== undefined && { duration })
      }
    })

    // Log audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PUNISHMENT_EDIT',
        targetId: updated.discordId,
        details: {
          punishmentId: updated.id,
          editedFields: { type, reason, proofUrl, duration }
        }
      }
    })

    return NextResponse.json({ success: true, punishment: updated })
  } catch (error: any) {
    console.error('[Punishment Edit Error]', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  // DELETE IS STRICTLY FOR OWNER ROLE!
  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden: Owner role required' }, { status: 403 })
  }

  try {
    const { punishmentId } = await request.json()

    if (!punishmentId) {
      return NextResponse.json({ error: 'Missing punishment ID' }, { status: 400 })
    }

    const deleted = await prisma.punishment.delete({
      where: { id: punishmentId }
    })

    // Log audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PUNISHMENT_DELETE',
        targetId: deleted.discordId,
        details: {
          punishmentId: deleted.id,
          type: deleted.type,
          reason: deleted.reason
        }
      }
    })

    return NextResponse.json({ success: true, message: 'Punishment deleted successfully' })
  } catch (error: any) {
    console.error('[Punishment Delete Error]', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
