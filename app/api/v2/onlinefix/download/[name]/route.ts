import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKeyOrAdmin, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'
import { sendWebhook } from '@/app/lib/webhooks'

/**
 * GET /api/v2/onlinefix/download/[name]
 * 
 * Searches for an OnlineFix by name and redirects to its direct download URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params

  // Authenticate
  const auth = await authenticateApiKeyOrAdmin(request)
  
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized: Missing or invalid API key.' },
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }

  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  if (!name) {
    return NextResponse.json(
      { error: 'Fix name parameter is required.' },
      { status: 400, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

  const decodedName = decodeURIComponent(name).trim()

  try {
    // 1. Try exact match first (case-insensitive)
    let games = await prisma.onlineFixGame.findMany({
      where: {
        name: {
          equals: decodedName,
          mode: 'insensitive'
        }
      },
      orderBy: { searches: 'desc' },
      take: 1
    })

    // 2. If no exact match, try contains
    if (games.length === 0) {
      games = await prisma.onlineFixGame.findMany({
        where: {
          name: {
            contains: decodedName,
            mode: 'insensitive'
          }
        },
        orderBy: { searches: 'desc' },
        take: 1
      })
    }

    if (games.length === 0) {
      enrichLog(auth.usageLogId, 404, decodedName)
      return NextResponse.json(
        { error: `OnlineFix not found for name: ${decodedName}` },
        { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    const game = games[0]
    const { getOnlineFixDownloadUrl } = require('@/scripts/lib/onlinefix-s3')
    const downloadUrl = await getOnlineFixDownloadUrl(game)

    if (!downloadUrl) {
      enrichLog(auth.usageLogId, 503, game.name)
      return NextResponse.json(
        { error: 'OnlineFix S3 storage is not configured.' },
        { status: 503, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    // Fire and forget search increment
    prisma.onlineFixGame.update({
      where: { id: game.id },
      data: { searches: { increment: 1 } }
    }).catch(() => {})

    await sendWebhook('ONLINEFIX_DOWNLOAD', {
      gameName: game.name,
      keyName: auth.apiKeyId,
      username: auth.user.username,
      userId: auth.user.id,
      plan: auth.user.plan,
      userAgent: request.headers.get('user-agent') || 'API Path'
    })

    enrichLog(auth.usageLogId, 302, game.name)

    // Redirect to the file URL
    return NextResponse.redirect(downloadUrl, 302)

  } catch (error: any) {
    console.error('[API OnlineFix Download] Error:', error)
    enrichLog(auth.usageLogId, 500, decodedName)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }
}

async function enrichLog(usageLogId: string | undefined, status: number, appName?: string) {
  if (!usageLogId) return
  try {
    await prisma.apiUsage.update({
      where: { id: usageLogId },
      data: { status, requestedName: appName ?? null }
    })
  } catch (error) {
    // Silent catch as per original logic
  }
}
