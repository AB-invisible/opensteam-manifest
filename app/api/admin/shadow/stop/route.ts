import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'

/**
 * POST /api/admin/shadow/stop
 * Admin exits Shadow Mode and returns to their own context.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  
  // Security check: Must have a valid session
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  // Note: shadow/stop doesn't require a specific role because any authenticated user
  // who is shadowing should be able to exit (their identity is locked to their real
  // discordId in the JWT). The DB lookup below confirms they actually exist.

  try {
    // We fetch the real ID from the session (populated in our shadow logic)
    // or we use the discordId from the token if it's the real user identity.
    // In our session callback, u.discordId is always the real one from the token.
    const realDiscordId = (session.user as any).discordId

    // 1. Fetch the actual Admin user from DB
    const adminUser = await prisma.user.findUnique({
      where: { discordId: realDiscordId }
    })

    if (!adminUser) {
      return NextResponse.json({ error: 'System user not found.' }, { status: 404 })
    }

    // 2. Clear the shadowingId on the real user account
    await (prisma.user as any).update({
      where: { id: adminUser.id },
      data: { shadowingId: null }
    })

    // 3. Log the exit
    await (prisma as any).auditLog.create({
      data: {
        userId: adminUser.id,
        action: 'ADMIN_SHADOW_STOP',
        details: 'Administrator exited Shadow Mode',
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    return NextResponse.json({ success: true, message: 'Shadow Mode disabled.' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
