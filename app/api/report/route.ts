import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders } from '@/app/lib/auth'
import { assertAppSessionOwnership } from '@/app/lib/app-session'

/**
 * POST /api/report
 * 
 * Receives heartbeats and user-action events from the desktop client.
 * Upserts the session and returns any pending admin commands.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      sessionId, 
      apiKey: keyString, 
      appVersion, 
      event, 
      timestamp 
    } = body

    if (!sessionId || !keyString) {
      return NextResponse.json({ error: 'Missing sessionId or apiKey' }, { status: 400 })
    }

    const auth = await authenticateApiKey(request, { providedKey: keyString, skipUsage: true })
    if (!auth) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    const ownership = await assertAppSessionOwnership(sessionId, auth.apiKeyId)
    if (!ownership.ok) {
      const message = ownership.status === 400 ? 'Invalid sessionId format' : 'Forbidden'
      return NextResponse.json({ error: message }, { status: ownership.status })
    }

    await prisma.appSession.upsert({
      where: { id: sessionId },
      update: {
        lastSeen: new Date(),
        appVersion: appVersion || 'unknown',
      },
      create: {
        id: sessionId,
        apiKeyId: auth.apiKeyId,
        userId: auth.user.id,
        appVersion: appVersion || 'unknown',
        lastSeen: new Date(),
      }
    })

    if (event && event.type) {
      await prisma.appEvent.create({
        data: {
          sessionId,
          type: event.type,
          appId: event.appId ? String(event.appId) : null,
          gameName: event.gameName || null,
          success: event.success === true,
          detail: event.detail || null,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
        }
      })
    }

    return NextResponse.json({
      disable: auth.apiKey.adminDisable === true,
      forceUpdate: auth.apiKey.adminForceUpdate === true
    }, { 
      headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) 
    })

  } catch (error) {
    console.error('[/api/report] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
