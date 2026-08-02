import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { authOptions } from '@/app/lib/auth-options'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminUser = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
    if (!adminUser || adminUser.role !== 'OWNER') return NextResponse.json({ error: 'Access Denied' }, { status: 403 })

    const { enableAll } = await request.json()

    await prisma.apiKey.updateMany({
      data: { enabled: enableAll }
    })

    return NextResponse.json({ success: true, enabled: enableAll })
  } catch (error) {
    console.error('Error bulk toggling keys:', error)
    return NextResponse.json({ error: 'Failed to bulk toggle API keys' }, { status: 500 })
  }
}
