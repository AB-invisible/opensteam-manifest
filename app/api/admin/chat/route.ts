import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'

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

    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR' && caller.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers })
    }

    const messages = await prisma.adminChatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: {
            username: true,
            avatar: true,
            discordId: true,
            role: true
          }
        }
      }
    })

    return NextResponse.json({ messages: messages.reverse() }, { headers })
  } catch (error) {
    console.error('Error fetching chat messages:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500, headers })
  }
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR' && caller.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers })
    }

    const { content } = await request.json()
    const trimmedContent = typeof content === 'string' ? content.trim() : ''
    if (!trimmedContent) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400, headers })
    }

    const recentDuplicate = await prisma.adminChatMessage.findFirst({
      where: {
        userId: caller.id,
        content: trimmedContent,
        createdAt: { gte: new Date(Date.now() - 2000) },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            username: true,
            avatar: true,
            discordId: true,
            role: true
          }
        }
      }
    })

    if (recentDuplicate) {
      return NextResponse.json({ success: true, message: recentDuplicate, duplicate: true }, { headers })
    }

    const message = await prisma.adminChatMessage.create({
      data: {
        userId: caller.id,
        username: caller.username,
        avatar: caller.avatar,
        content: trimmedContent,
        role: caller.role
      },
      include: {
        user: {
          select: {
            username: true,
            avatar: true,
            discordId: true,
            role: true
          }
        }
      }
    })

    // Notify all stream clients
    const { chatEmitter } = await import('@/app/lib/chat-events')
    chatEmitter.emit('chat-message', message)

    return NextResponse.json({ success: true, message }, { headers })
  } catch (error) {
    console.error('Error sending chat message:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500, headers })
  }
}
