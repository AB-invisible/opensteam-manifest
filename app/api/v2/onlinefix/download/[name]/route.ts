import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKeyOrAdmin, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'
import { sendWebhook } from '@/app/lib/webhooks'

async function findOnlineFixGame(decodedName: string) {
  const exact = await prisma.onlineFixGame.findFirst({
    where: { name: { equals: decodedName, mode: 'insensitive' } },
    orderBy: { searches: 'desc' },
  })
  if (exact) return exact

  const byFile = await prisma.onlineFixGame.findFirst({
    where: { fileName: { equals: decodedName, mode: 'insensitive' } },
    orderBy: { searches: 'desc' },
  })
  if (byFile) return byFile

  return prisma.onlineFixGame.findFirst({
    where: { name: { contains: decodedName, mode: 'insensitive' } },
    orderBy: { searches: 'desc' },
  })
}

function wantsDirectStream(request: NextRequest) {
  const accept = (request.headers.get('accept') || '').toLowerCase()
  return accept.includes('octet-stream') || accept.includes('zip') || accept.includes('application/x-rar')
}

/**
 * GET /api/v2/onlinefix/download/[name]
 *
 * Streams or redirects to an OnlineFix archive. Desktop app requests are streamed
 * through this API so missing S3 objects fall back to PeronDepot automatically.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params

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
    const { ensureOnlineFixCatalog, getOnlineFixDownloadUrl, streamOnlineFixArchive } =
      require('@/scripts/lib/onlinefix-s3')

    let game = await findOnlineFixGame(decodedName)

    if (!game) {
      await ensureOnlineFixCatalog({ prismaClient: prisma }).catch((err) => {
        console.warn('[API OnlineFix Download] Catalog bootstrap failed:', err?.message || err)
      })
      game = await findOnlineFixGame(decodedName)
    }

    if (!game) {
      enrichLog(auth.usageLogId, 404, decodedName)
      return NextResponse.json(
        { error: `OnlineFix not found for name: ${decodedName}` },
        { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    const streamClient = wantsDirectStream(request)

    if (streamClient) {
      try {
        const payload = await streamOnlineFixArchive(game)
        if (payload?.buffer) {
          prisma.onlineFixGame
            .update({ where: { id: game.id }, data: { searches: { increment: 1 } } })
            .catch(() => {})

          await sendWebhook('ONLINEFIX_DOWNLOAD', {
            gameName: game.name,
            keyName: auth.apiKeyId,
            username: auth.user.username,
            userId: auth.user.id,
            plan: auth.user.plan,
            userAgent: request.headers.get('user-agent') || 'API Path',
          }).catch(() => {})

          enrichLog(auth.usageLogId, 200, game.name)

          const headers = apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin'))
          headers.set('Content-Type', 'application/octet-stream')
          headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(payload.fileName || game.fileName)}"`)
          headers.set('Content-Length', String(payload.contentLength || payload.buffer.length))

          return new NextResponse(payload.buffer, { status: 200, headers })
        }
      } catch (streamErr: any) {
        console.warn('[API OnlineFix Download] Stream failed, trying redirect:', streamErr?.message || streamErr)
      }
    }

    const downloadUrl = await getOnlineFixDownloadUrl(game)

    if (!downloadUrl) {
      enrichLog(auth.usageLogId, 503, game.name)
      return NextResponse.json(
        { error: 'OnlineFix download source is unavailable for this game.' },
        { status: 503, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    prisma.onlineFixGame
      .update({ where: { id: game.id }, data: { searches: { increment: 1 } } })
      .catch(() => {})

    await sendWebhook('ONLINEFIX_DOWNLOAD', {
      gameName: game.name,
      keyName: auth.apiKeyId,
      username: auth.user.username,
      userId: auth.user.id,
      plan: auth.user.plan,
      userAgent: request.headers.get('user-agent') || 'API Path',
    }).catch(() => {})

    enrichLog(auth.usageLogId, 302, game.name)

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
      data: { status, requestedName: appName ?? null },
    })
  } catch (error) {
    // Silent catch as per original logic
  }
}
