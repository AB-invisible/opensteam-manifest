import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string },
      select: { role: true }
    })

    const allowedRoles = ['MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER']
    if (!user || !allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Access Denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const apiKeyId = searchParams.get('keyId') || undefined
    const skip = (page - 1) * limit

    const whereClause: any = {}
    if (apiKeyId) {
      whereClause.apiKeyId = apiKeyId
    }

    const [logs, total] = await Promise.all([
      prisma.apiUsage.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          apiKey: {
            select: { name: true, user: { select: { username: true } } }
          }
        }
      }),
      prisma.apiUsage.count({ where: whereClause })
    ])

    return NextResponse.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Error fetching admin api logs:', error)
    return NextResponse.json({ error: 'Failed to fetch global API logs' }, { status: 500 })
  }
}
