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

    const { enableRegistration } = await request.json()

    await prisma.systemConfig.upsert({
      where: { key: 'REGISTRATION_ENABLED' },
      update: { value: enableRegistration ? 'true' : 'false' },
      create: { key: 'REGISTRATION_ENABLED', value: enableRegistration ? 'true' : 'false' }
    })

    return NextResponse.json({ success: true, enabled: enableRegistration })
  } catch (error) {
    console.error('Error toggling registration:', error)
    return NextResponse.json({ error: 'Failed to toggle registration' }, { status: 500 })
  }
}
