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

    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'OWNER')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // 'versions' or 'audits'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = 50
    const skip = (page - 1) * limit

    if (type === 'versions') {
      const [versions, total] = await Promise.all([
        prisma.manifestVersion.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.manifestVersion.count()
      ])

      return NextResponse.json({
        data: versions,
        pagination: { page, totalPages: Math.ceil(total / limit), total }
      }, { headers })
    }

    if (type === 'audits') {
      const [audits, total] = await Promise.all([
        prisma.keyAudit.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: { apiKey: { include: { user: { select: { username: true } } } } }
        }),
        prisma.keyAudit.count()
      ])

      return NextResponse.json({
        data: audits,
        pagination: { page, totalPages: Math.ceil(total / limit), total }
      }, { headers })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400, headers })
  } catch (error) {
    console.error('[Admin Vault API Error]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers })
  }
}
