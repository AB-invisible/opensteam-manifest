import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code')?.trim().toUpperCase()
    const machineId = request.nextUrl.searchParams.get('machineId')?.trim()

    if (!code || !machineId) {
      return NextResponse.json({ error: 'code and machineId are required.' }, { status: 400 })
    }

    const pairing = await prisma.devicePairing.findUnique({ where: { code } })
    if (!pairing || pairing.machineId !== machineId) {
      return NextResponse.json({ status: 'invalid' })
    }

    if (pairing.expiresAt < new Date()) {
      return NextResponse.json({ status: 'expired' })
    }

    if (!pairing.apiKeyId) {
      return NextResponse.json({ status: 'pending', expiresAt: pairing.expiresAt.toISOString() })
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { id: pairing.apiKeyId },
      select: { key: true, enabled: true },
    })

    if (!apiKey?.enabled) {
      return NextResponse.json({ status: 'revoked' })
    }

    return NextResponse.json({ status: 'ready', apiKey: apiKey.key })
  } catch (error) {
    console.error('[pairing/status]', error)
    return NextResponse.json({ error: 'Failed to check pairing status.' }, { status: 500 })
  }
}
