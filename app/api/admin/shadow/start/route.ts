import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'

/**
 * POST /api/admin/shadow/start
 * Admin initiates Shadow Mode on a target user.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const adminDiscordId = (session.user as any).discordId

    // 1. Fetch the actual Admin user from DB — never trust JWT role alone for
    //    privileged operations. The JWT can be stale after a role change.
    const user = await prisma.user.findUnique({
      where: { discordId: adminDiscordId }
    })

    if (!user) {
      return NextResponse.json({ error: 'System user not found.' }, { status: 404 })
    }

    // Security: Only actual OWNERs (re-validated from DB) can initiate Shadow Mode
    if ((user.role as string) !== 'OWNER') {
      return NextResponse.json({ error: 'Unauthorized. Owner role required.' }, { status: 403 })
    }

    // Prevent recursive shadowing
    if ((user as any).shadowingId) {
      return NextResponse.json({ error: 'Already in Shadow Mode.' }, { status: 400 })
    }

    const { targetUserId } = await request.json()
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ error: 'Target User ID is required.' }, { status: 400 })
    }

    // 2. Verify the target user actually exists before setting shadowingId
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } })
    if (!targetUser) {
      return NextResponse.json({ error: 'Target user not found.' }, { status: 404 })
    }

    // 3. Update the Admin’s record to point to the target user
    await (prisma.user as any).update({
      where: { id: user.id },
      data: { shadowingId: targetUserId }
    })

    // 3. Log the sensitive sovereignty action
    await (prisma as any).auditLog.create({
      data: {
        userId: user.id,
        action: 'ADMIN_SHADOW_START',
        targetId: targetUserId,
        details: `Administrator initiated Shadow Mode on User ${targetUserId}`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true, message: 'Shadow Mode active. Please refresh your session.' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
