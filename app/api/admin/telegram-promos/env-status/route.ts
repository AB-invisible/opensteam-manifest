import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'

export const dynamic = 'force-dynamic'

async function checkAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return false
  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { role: true },
  })
  return user?.role === 'ADMIN' || user?.role === 'OWNER'
}

export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    hasBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasChannelId: !!process.env.TELEGRAM_PUBLIC_CHANNEL_ID,
    hasAdminGroupId: !!process.env.TELEGRAM_ADMIN_GROUP_ID,
  })
}
