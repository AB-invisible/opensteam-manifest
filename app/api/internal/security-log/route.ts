import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { sendWebhook } from '@/app/lib/webhooks'
import { verifyInternalServiceSecret } from '@/app/lib/internal-service-auth'

/**
 * POST /api/internal/security-log
 *
 * Internal endpoint used by edge middleware or stateless auth checks
 * to fire an ABUSE_ALERT webhook. Looks up the IP in the database
 * to attach a username if the IP belongs to a known user.
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyInternalServiceSecret(request.headers.get('x-internal-secret'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { ip, path, userAgent, reason, details, ...securityFields } = body

    if (!ip || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    let username = 'Unknown (Guest)'
    let userId = 'N/A'

    const knownUser = await prisma.user.findFirst({
      where: { lastIp: ip },
      select: { username: true, id: true },
      orderBy: { updatedAt: 'desc' },
    })

    if (knownUser) {
      username = knownUser.username || 'Unknown'
      userId = knownUser.id
    }

    await sendWebhook('ABUSE_ALERT', {
      ip,
      userAgent: userAgent || 'unknown',
      userId,
      username,
      reason,
      path,
      details: details || undefined,
      ...securityFields,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Security Log Internal API] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
