import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN' && user.role !== 'SENIOR_MODERATOR' && user.role !== 'MODERATOR')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    const [generations, total] = await Promise.all([
      prisma.webGeneration.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              username: true,
              discordId: true,
              plan: true
            }
          }
        }
      }),
      prisma.webGeneration.count()
    ])

    return NextResponse.json({
      generations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('[Admin Generations API] Error fetching generations:', error)
    return NextResponse.json({ error: 'Failed to fetch generations' }, { status: 500 })
  }
}
