import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId },
      select: { role: true }
    })

    // Role Isolation: Allow Moderators but filter out Admin actions
    if (!user || user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Access Denied.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    // Filter logic: Moderators cannot see logs of Admin actions
    const where = {}

    const [logs, total] = await Promise.all([
      (prisma as any).auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { username: true, discriminator: true, avatar: true, role: true, discordId: true } }
        }
      }),
      (prisma as any).auditLog.count({ where })
    ])

    return NextResponse.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Audit Log Fetch Error:', error)
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}
