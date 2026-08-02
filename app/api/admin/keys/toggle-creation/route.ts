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

    const { enableCreation } = await request.json()
    const valueStr = enableCreation ? 'true' : 'false'

    await prisma.systemConfig.upsert({
      where: { key: 'KEYS_CREATION_ENABLED' },
      update: { value: valueStr },
      create: { key: 'KEYS_CREATION_ENABLED', value: valueStr }
    })

    return NextResponse.json({ success: true, enabled: enableCreation })
  } catch (error) {
    console.error('Error toggling key creation:', error)
    return NextResponse.json({ error: 'Failed to toggle API key creation' }, { status: 500 })
  }
}
