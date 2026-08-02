import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { sendTelegramPublicPromo } from '@/app/lib/telegram-bot'

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

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set in environment variables.' }, { status: 400 })
  }
  if (!process.env.TELEGRAM_PUBLIC_CHANNEL_ID) {
    return NextResponse.json({ error: 'TELEGRAM_PUBLIC_CHANNEL_ID is not set in environment variables.' }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { id } = body
    if (!id || typeof id !== 'string') return NextResponse.json({ error: 'Promo ID is required' }, { status: 400 })

    const promo = await prisma.telegramPromoMessage.findUnique({ where: { id } })
    if (!promo) return NextResponse.json({ error: 'Promo not found' }, { status: 404 })

    const success = await sendTelegramPublicPromo(promo.text, promo.photo || undefined)
    if (!success) {
      return NextResponse.json({ error: 'Telegram returned an error. Check bot token and channel ID.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[send-now] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
