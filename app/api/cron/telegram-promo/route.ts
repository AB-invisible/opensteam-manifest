import { NextRequest, NextResponse } from 'next/server'
import { sendTelegramPublicPromo } from '@/app/lib/telegram-bot'
import { verifyBearerSecret } from '@/app/lib/bearer-auth'
import { getRuntimeSecret, requireRuntimeSecretInProduction } from '@/app/lib/runtime-secrets'
import { prisma } from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  const cronSecret = await getRuntimeSecret('CRON_SECRET')

  const missingSecretResponse = requireRuntimeSecretInProduction(cronSecret, 'CRON_SECRET', 'Cron')
  if (missingSecretResponse) {
    return missingSecretResponse
  }

  if (cronSecret && !verifyBearerSecret(req.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const activePromos = await prisma.telegramPromoMessage.findMany({
      where: { isActive: true }
    })

    if (activePromos.length === 0) {
      return NextResponse.json({ message: 'No active promos to send' })
    }

    const selectedPromo = activePromos[Math.floor(Math.random() * activePromos.length)]

    const success = await sendTelegramPublicPromo(selectedPromo.text, selectedPromo.photo || undefined)
    
    if (!success) {
      return NextResponse.json({ error: 'Failed to send promo to Telegram' }, { status: 500 })
    }

    return NextResponse.json({ success: true, promo: selectedPromo.text })
  } catch (err) {
    console.error('[Cron] Error sending Telegram promo:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
