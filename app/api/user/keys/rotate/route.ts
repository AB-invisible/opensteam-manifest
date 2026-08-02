import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { rotateApiKey } from '@/app/lib/auth'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'

/**
 * POST /api/user/keys/rotate
 * Body: { keyId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { keyId } = await request.json()
    if (!keyId) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 })
    }

    // Verify ownership
    const key = await prisma.apiKey.findUnique({
      where: { id: keyId },
      include: { user: true }
    })

    if (!key || (key.user.discordId !== (session.user as any).discordId)) {
      return NextResponse.json({ error: 'Key not found or access denied' }, { status: 404 })
    }

    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1'
    const newKey = await rotateApiKey(keyId, ip)

    return NextResponse.json({
      success: true,
      newKey,
      message: 'API Key rotated successfully. Please update your applications immediately.'
    })
  } catch (error) {
    console.error('[Key Rotation Error]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
