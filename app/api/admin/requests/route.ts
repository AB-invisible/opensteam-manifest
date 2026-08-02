import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { sendWebhook } from '@/app/lib/webhooks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'OWNER' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR')) {
      return NextResponse.json({ error: 'Forbidden. Staff access required.' }, { status: 403, headers })
    }

    const requests = await prisma.gameRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { username: true, discordId: true, avatar: true } }
      }
    })

    return NextResponse.json({ requests }, { headers })
  } catch (error) {
    console.error('Error fetching requests:', error)
    return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500, headers })
  }
}

export async function PUT(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'OWNER' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR')) {
      return NextResponse.json({ error: 'Forbidden. Staff access required.' }, { status: 403, headers })
    }

    const { requestId, status } = await request.json()

    if (!requestId || !status) {
      return NextResponse.json({ error: 'Request ID and status are required' }, { status: 400, headers })
    }

    const updatedRequest = await prisma.gameRequest.update({
      where: { id: requestId },
      data: { status },
      include: { user: true }
    })

    // Trigger Discord Request Update
    import('@/app/lib/discord-requests').then(m => {
      m.updateDiscordGameRequest(updatedRequest.id).catch(() => {})
    })

    // Trigger webhook for approval/denial
    if (status === 'FULFILLED' || status === 'DONE') {
      sendWebhook('REQUEST_APPROVED', {
        username: updatedRequest.user.username,
        gameName: updatedRequest.name,
        appId: updatedRequest.appId,
        userId: updatedRequest.userId
      })
    } else if (status === 'REJECTED') {
      sendWebhook('REQUEST_DENIED', {
        username: updatedRequest.user.username,
        gameName: updatedRequest.name,
        appId: updatedRequest.appId,
        userId: updatedRequest.userId
      })
    }

    const { createAuditLog } = await import('@/app/lib/audit')
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    await createAuditLog(
      caller.id, 
      status === 'REJECTED' ? 'REJECT_REQUEST' : 'APPROVE_REQUEST', 
      updatedRequest.id, 
      `Status: ${status} for ${updatedRequest.name} (${updatedRequest.appId})`, 
      ip
    )

    return NextResponse.json({ success: true, request: updatedRequest }, { headers })
  } catch (error) {
    console.error('Error updating game request:', error)
    return NextResponse.json({ error: 'Failed to update game request' }, { status: 500, headers })
  }
}
