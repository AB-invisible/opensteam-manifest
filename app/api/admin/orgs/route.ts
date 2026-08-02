import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!caller || caller.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const organizations = await (prisma as any).organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { username: true, discordId: true, avatar: true } },
        _count: {
          select: { members: true, apiKeys: true }
        }
      }
    })

    return NextResponse.json({ organizations })
  } catch (error) {
    console.error('Error fetching admin orgs:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!caller || caller.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { orgId, plan } = await request.json()

    if (!orgId || !plan) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const org = await (prisma as any).organization.update({
      where: { id: orgId },
      data: { plan }
    })

    // Log action
    const { createAuditLog } = await import('@/app/lib/audit')
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    await createAuditLog(caller.id, 'UPDATE_ORG_PLAN', orgId, `Set plan to ${plan}`, ip)

    return NextResponse.json({ success: true, org })
  } catch (error) {
    console.error('Error updating org:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
