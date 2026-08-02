import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { randomBytes } from 'crypto'

const CODE_TTL_MS = 15 * 60 * 1000

function generateCode() {
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 8)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const machineId = String(body.machineId || '').trim()
    if (!machineId || machineId.length < 8) {
      return NextResponse.json({ error: 'machineId is required.' }, { status: 400 })
    }

    const os = body.os ? String(body.os) : null
    const appVersion = body.version ? String(body.version) : null

    await prisma.devicePairing.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    const existingKey = await prisma.apiKey.findFirst({
      where: { machineId, enabled: true },
      select: { id: true },
    })
    if (existingKey) {
      return NextResponse.json(
        { error: 'This device already has an API key. Use /key status in Discord if you need help.' },
        { status: 409 }
      )
    }

    await prisma.devicePairing.deleteMany({ where: { machineId } })

    let code = generateCode()
    for (let i = 0; i < 5; i++) {
      const clash = await prisma.devicePairing.findUnique({ where: { code } })
      if (!clash) break
      code = generateCode()
    }

    const expiresAt = new Date(Date.now() + CODE_TTL_MS)
    await prisma.devicePairing.create({
      data: { code, machineId, os, appVersion, expiresAt },
    })

    return NextResponse.json({
      code,
      expiresAt: expiresAt.toISOString(),
      instructions: 'In the OpenSteam Discord server, run: /key pair code:' + code,
    })
  } catch (error) {
    console.error('[pairing/request]', error)
    return NextResponse.json({ error: 'Failed to create pairing code.' }, { status: 500 })
  }
}
