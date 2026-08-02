import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

/**
 * GET /api/admin/sentinel
 * Fetch Sentinel logs for admin review.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || ((session.user as any).role !== 'ADMIN' && (session.user as any).role !== 'OWNER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const skip = (page - 1) * limit

  try {
    const [logs, total] = await Promise.all([
      (prisma as any).sentinelLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, discordId: true } } }
      }),
      (prisma as any).sentinelLog.count()
    ])

    return NextResponse.json({
      logs,
      page,
      totalPages: Math.ceil(total / limit),
      total
    })
  } catch (error) {
    console.error('Failed to fetch sentinel logs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
