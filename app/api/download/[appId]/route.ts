import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse, AuthResult } from '@/app/lib/auth'
import { buildRateLimitDenial, webRateLimitResponse } from '@/app/lib/rate-limit-denial'
import { checkWebDailyQuota, webQuotaHeaders } from '@/app/lib/ratelimit'
import { getManifestBuffer } from '@/app/lib/storage'
import { prepareCleanManifestZip, manifestZipAttachmentHeaders } from '@/app/lib/deliver-manifest'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { safeManifestFilename, isPlaceholderManifestName, fetchSteamGameName } from '@/app/lib/manifest-filename'

/**
 * GET /api/download/[appId]
 * 
 * Downloads the zip file for a manifest by its Steam App ID.
 * Works via Web Session OR API Bearer Token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const { appId } = params

  let hasAccess = false
  let bearerAuth: AuthResult | null = null
  let dbUser: any = null

  // 1. Try API Key Auth first
  const authHeader = request.headers.get('Authorization')
  if (authHeader) {
    const auth = await authenticateApiKey(request, { skipUsage: true })
    if (!auth) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) })
    }
    if (!isApiAccessAllowed(auth)) {
      return apiRateLimitResponse(auth, request.headers.get('Origin'))
    }
    hasAccess = true
    bearerAuth = auth
  } else {
    // 2. Fall back to Web UI Session Auth
    const session = await getServerSession(authOptions)
    if (session && session.user) {
      hasAccess = true
      dbUser = await prisma.user.findUnique({
        where: { discordId: session.user.discordId as string }
      })
    }
  }

  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Invalid or missing API key or User Session' },
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }

  // 1. Check manifest exists in database for metadata
  const manifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId }
  })

  // 2. Try to serve from local storage/S3.
  // Buffer (not stream) so we can pass it through cleanManifestZip — strips
  // any leftover upstream attribution from the .lua and prepends our credit.
  // Manifests are tiny (sub-MB) so buffering is fine.
  const storageBuffer = await getManifestBuffer(appId)

  if (storageBuffer) {
    console.log(`[Download] Serving ${appId} from storage`)
    // If the DB name is missing or still a placeholder ("App 12345" / "Manifest 12345"),
    // pull the real name from Steam so the downloaded file uses the actual game title.
    let resolvedName = manifest?.name || ''
    if (isPlaceholderManifestName(resolvedName)) {
      const steamName = await fetchSteamGameName(appId)
      if (steamName) {
        resolvedName = steamName
        // Passive backfill: heal the DB row so future downloads + UI display use the real name.
        if (manifest) {
          prisma.manifest.update({
            where: { id: manifest.id },
            data: { name: steamName }
          }).catch(() => {})
        }
      }
    }

    // Increment download counter ONLY if it exists in DB
    if (manifest) {
      prisma.manifest.update({
        where: { id: manifest.id },
        data: { downloads: { increment: 1 } }
      }).catch(() => {})
    }

    const cleanedBuffer = await prepareCleanManifestZip(appId, storageBuffer)
    if (!cleanedBuffer) {
      return NextResponse.json(
        { error: `No manifest found for app ID: ${appId}` },
        { status: 404, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    return new NextResponse(new Uint8Array(cleanedBuffer), {
      headers: manifestZipAttachmentHeaders(
        safeManifestFilename(resolvedName, appId),
        cleanedBuffer,
        bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')),
      ),
    })
  }

  if (!manifest) {
    if (!dbUser) {
      return NextResponse.json(
        { error: `No manifest found for app ID: ${appId}` },
        { status: 404, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    const webQuota = await checkWebDailyQuota(dbUser.id, dbUser)
    if (!webQuota.allowed) {
      const denial = buildRateLimitDenial(
        'WEB_DAILY_QUOTA',
        webQuota.errorReason || 'Daily web generation limit reached.',
        { resetAt: webQuota.resetAt, limit: webQuota.limit, remaining: 0, scope: 'web' }
      )
      return webRateLimitResponse(
        denial,
        { todayCount: webQuota.todayCount, dailyWebLimit: webQuota.limit },
        {
          ...(bearerAuth
            ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin'))
            : apiHeaders(undefined, undefined, request.headers.get('Origin'))),
          ...webQuotaHeaders(webQuota),
        }
      )
    }

    console.log(`[Download Proxy] ${appId} not in DB or Storage. Fetching real-time from upstream for Web User...`)
    const { fetchManifestZipWithPlanGates } = await import('@/app/lib/upstream-manifest-fetch')
    const up = await fetchManifestZipWithPlanGates(appId, dbUser)
    if (!up.ok && up.reason === 'forbidden') {
      return NextResponse.json(
        {
          error: 'Real-time manifest download is not enabled for your plan (Ryuu / Morrenus overrides).',
        },
        { status: 403, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }
    if (!up.ok) {
      return NextResponse.json(
        { error: `Zip file not found for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    // Track generation (fire-and-forget)
    prisma.webGeneration.create({
      data: { userId: dbUser.id, appId: appId, gameName: `App ${appId}` }
    }).catch(() => {})

    // Return cleaned upstream buffer — try Steam for a proper filename
    const upstreamName = await fetchSteamGameName(appId)
    const cleanedBuffer = await prepareCleanManifestZip(appId, up.zipBuffer)
    if (!cleanedBuffer) {
      return NextResponse.json(
        { error: `Zip file not found for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }
    return new NextResponse(new Uint8Array(cleanedBuffer), {
      headers: manifestZipAttachmentHeaders(
        safeManifestFilename(upstreamName, appId),
        cleanedBuffer,
        bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')),
      ),
    })
  }

  // 3. Serve from storage with OpenSteam credit applied on delivery
  const cleanedBuffer = await prepareCleanManifestZip(appId)

  if (!cleanedBuffer) {
    const gateUser = bearerAuth?.user ?? dbUser
    if (!gateUser) {
      return NextResponse.json(
        { error: 'User context required for proxy download.' },
        { status: 403, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    console.log(`[Download Proxy] ${appId} not in bucket. Fetching real-time from upstream...`)
    const { fetchManifestZipWithPlanGates } = await import('@/app/lib/upstream-manifest-fetch')
    const up = await fetchManifestZipWithPlanGates(appId, gateUser)
    if (!up.ok && up.reason === 'forbidden') {
      return NextResponse.json(
        {
          error: 'Real-time manifest download is not enabled for your plan (Ryuu / Morrenus overrides).',
        },
        { status: 403, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }
    if (!up.ok) {
      return NextResponse.json(
        { error: `Zip file not found for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    // Return cleaned upstream buffer — heal name if it's still a placeholder
    let upstreamName = manifest.name
    if (isPlaceholderManifestName(upstreamName)) {
      const steamName = await fetchSteamGameName(appId)
      if (steamName) {
        upstreamName = steamName
        prisma.manifest.update({ where: { id: manifest.id }, data: { name: steamName } }).catch(() => {})
      }
    }
    const cleanedUpstream = await prepareCleanManifestZip(appId, up.zipBuffer)
    if (!cleanedUpstream) {
      return NextResponse.json(
        { error: `Zip file not found for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }
    return new NextResponse(new Uint8Array(cleanedUpstream), {
      headers: manifestZipAttachmentHeaders(
        safeManifestFilename(upstreamName, appId),
        cleanedUpstream,
        bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')),
      ),
    })
  }

  // Increment download counter (fire-and-forget)
  prisma.manifest.update({
    where: { id: manifest.id },
    data: { downloads: { increment: 1 } }
  }).catch(() => {})

  // Resolve display name (heal placeholder via Steam if needed)
  let finalName = manifest.name
  if (isPlaceholderManifestName(finalName)) {
    const steamName = await fetchSteamGameName(appId)
    if (steamName) {
      finalName = steamName
      prisma.manifest.update({ where: { id: manifest.id }, data: { name: steamName } }).catch(() => {})
    }
  }

  return new NextResponse(new Uint8Array(cleanedBuffer), {
    headers: manifestZipAttachmentHeaders(
      safeManifestFilename(finalName, appId),
      cleanedBuffer,
      bearerAuth ? apiHeaders(bearerAuth.rateLimit, bearerAuth.dailyQuota, request.headers.get('Origin')) : apiHeaders(undefined, undefined, request.headers.get('Origin')),
    ),
  })
}
