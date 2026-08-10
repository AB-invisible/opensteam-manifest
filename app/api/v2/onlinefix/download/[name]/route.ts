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

/**
 * GET /api/v2/onlinefix/download/[name]
 *
 * Always streams the archive through this API (S3 when present, PeronDepot fallback).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  const { name } = params

  const auth = await authenticateApiKeyOrAdmin(request, { skipUsage: true })

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
    const { ensureOnlineFixCatalog, streamOnlineFixArchive } = require('@/scripts/lib/onlinefix-s3')

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

    const payload = await streamOnlineFixArchive(game)
    if (!payload?.buffer?.length) {
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

    enrichLog(auth.usageLogId, 200, game.name)

    const headers = apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin'))
    headers.set('Content-Type', 'application/octet-stream')
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(payload.fileName || game.fileName)}"`
    )
    headers.set('Content-Length', String(payload.contentLength || payload.buffer.length))
    headers.set('X-OnlineFix-Source', payload.source || 'unknown')

    return new NextResponse(payload.buffer, { status: 200, headers })
  } catch (error: any) {
    console.error('[API OnlineFix Download] Error:', error)
    enrichLog(auth.usageLogId, 500, decodedName)
    return NextResponse.json(
      { error: error?.message || 'Internal Server Error' },
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
