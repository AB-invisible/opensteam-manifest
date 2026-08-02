import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { looksLikeApiKey } from '@/app/lib/api-key-middleware'
import { verifyInternalServiceSecret } from '@/app/lib/internal-service-auth'

export async function GET(request: NextRequest) {
  if (!verifyInternalServiceSecret(request.headers.get('x-internal-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = request.nextUrl.searchParams.get('key')

  if (!key || !looksLikeApiKey(key)) {
    return NextResponse.json({ valid: false }, { status: 400 })
  }

  try {
    const record = await prisma.apiKey.findUnique({
      where: { key },
      select: {
        id: true,
        enabled: true,
        user: { select: { isBanned: true, discordGuildBannedAt: true } },
      },
    })

    if (
      record?.enabled === true &&
      record.user.isBanned !== true &&
      !record.user.discordGuildBannedAt
    ) {
      return NextResponse.json({ valid: true })
    }
  } catch (error) {
    console.error('[Internal Check Key Error]', error)
  }

  return NextResponse.json({ valid: false })
}
