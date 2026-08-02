import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'
import { zipExists, readManifestFile } from '@/app/lib/storage'
import { fetchManifestFromMorrenus } from '@/app/lib/morrenus'
import { fetchManifestFromRyuu } from '@/app/lib/ryuu'
import { turbineCache } from '@/app/lib/cache'
import { canAccessRyuu, canUseMorrenusFallback } from '@/app/lib/config'
import { getPublicAppUrl } from '@/app/lib/public-app-url'
import { sendWebhook } from '@/app/lib/webhooks'

/**
 * GET /api/request/[appId]
 *
 * Programmatic manifest endpoint — requires Bearer API key.
 *
 * Plan gating:
 *  - REGULAR+: can fetch cached manifests
 *  - Plan defaults: Free includes Ryuu/Morrenus; paid tiers are off unless overrides enable them.
 *
 * Query params:
 *  - format=json (default) — manifest metadata + download URL
 *  - format=zip            — streams the ZIP directly
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const { appId } = params

  // ── 1. Auth + rate limit ──────────────────────────────────────────────────
  const auth = await authenticateApiKey(request)
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid or missing API key. Provide a Bearer token in the Authorization header.' },
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }
  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  // ── 2. Validate app ID ────────────────────────────────────────────────────
  if (!appId || !/^\d+$/.test(appId)) {
    return NextResponse.json(
      { error: 'Invalid Steam App ID — must be numeric.' },
      { status: 400, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

  const format = new URL(request.url).searchParams.get('format') || 'json'
  const requestedRegion = new URL(request.url).searchParams.get('region') || 'GLOBAL'
  const hasRyuuAccess = canAccessRyuu(auth.user)
  const hasMorrenusFallback = canUseMorrenusFallback(auth.user)

  try {
    const pubBase = getPublicAppUrl()

    // ── 3. Check cache / database ───────────────────────────────────────────
    const cacheKey = `manifest:${appId}`
    let manifest = turbineCache.get<any>(cacheKey)
    let wasGenerated = false

    if (!manifest) {
      manifest = await prisma.manifest.findUnique({ where: { steamAppId: appId } })
      if (manifest) {
         turbineCache.set(cacheKey, manifest)
      }
    }

    const storage = await import('@/app/lib/storage')
    const fileExists = await storage.anyStorageZipExists(appId)

    // Prefer S3 then local: if zip exists, we use it directly without a DB row
    if (fileExists && !manifest) {
      // Create a virtual manifest object for the response/cache
      const size = await storage.getManifestZipSizeBytes(appId)
      manifest = {
        id: `gen-${appId}-${Date.now()}`,
        steamAppId: appId,
        name: `App ${appId}`,
        fileSize: BigInt(size ?? 0),
        updatedAt: new Date(),
        createdAt: new Date(),
        tags: [],
      } as any
      turbineCache.set(cacheKey, manifest)
    }

    if (!fileExists) {
      // ── 4. No zip in S3 or local — plan gate ───────────────────────────
      if (!hasRyuuAccess) {
        if (!pubBase) {
          console.error('[request/[appId]] NEXT_PUBLIC_APP_URL is required in production')
          return NextResponse.json(
            { error: 'Server configuration error.' },
            { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
          )
        }
        return NextResponse.json(
          {
            error: 'Manifest not yet available for this App ID.',
            hint: 'Upstream auto-generation is not enabled for your plan. Ask an administrator to enable Ryuu/Morrenus in plan overrides, or use the Free tier defaults. '
              + 'You can request this game via the web dashboard or upgrade your plan.',
            upgradeUrl: `${pubBase}/pricing`,
          },
          { status: 403, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
        )
      }

      // ── 5. Fetch from External Sources (when plan overrides allow) ─────────
      console.log(`[Request API] No manifest zip in storage for ${appId}. Fetching from Ryuu...`)
      let result = await fetchManifestFromRyuu(appId)

      if (!result.success && hasMorrenusFallback) {
        console.log(`[Request API] Ryuu failed for ${appId}. Falling back to Morrenus...`)
        const ryuuErr = result.error
        const ryuuStatus = result.statusCode

        result = await fetchManifestFromMorrenus(appId)

        if (!result.success || !result.zipBuffer) {
          console.error(`[Request API] All upstream sources failed for ${appId}`)
          enrichLog(auth.apiKeyId, 404, appId)

          const isNotFound = (ryuuStatus === 404 || ryuuErr?.includes('status 404')) &&
            (result.statusCode === 404 || result.error?.includes('returned status 404'))

          if (!pubBase) {
            console.error('[request/[appId]] NEXT_PUBLIC_APP_URL is required in production')
            return NextResponse.json(
              { error: 'Server configuration error.' },
              { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
            )
          }

          return NextResponse.json(
            {
              error: isNotFound ? 'Manifest not found in any upstream source.' : (result.error || 'Failed to fetch manifest from upstream APIs.'),
              hint: 'This App ID is not yet available in our database or external providers. Please request it via the dashboard.',
              requestUrl: `${pubBase}/dashboard`,
              details: { ryuu: ryuuErr, morrenus: result.error }
            },
            { status: isNotFound ? 404 : 502, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
          )
        }
      }

      if (!result.success || !result.zipBuffer) {
        enrichLog(auth.apiKeyId, 404, appId)
        return NextResponse.json(
          {
            error: 'Manifest not found via upstream API.',
            hint: 'Enable Morrenus (or Ryuu) via plan overrides, or use the Free tier where both are on by default.',
            details: { ryuu: result.error }
          },
          { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
        )
      }

      // Fetch game name from Steam for the metadata (best-effort)
      let gameName = `App ${appId}`
      try {
        const steamRes = await fetch(
          `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`
        )
        const steamData = await steamRes.json()
        if (steamData[appId]?.success) {
          gameName = steamData[appId].data.name || gameName
        }
      } catch { /* non-critical */ }

      // Persist to storage but DO NOT write to DB
      await storage.persistManifest(appId, result.zipBuffer)

      manifest = {
        id: `gen-${appId}-${Date.now()}`,
        steamAppId: appId,
        name: gameName,
        fileSize: BigInt(result.zipBuffer.length),
        region: requestedRegion,
        updatedAt: new Date(),
        createdAt: new Date(),
        tags: [],
      } as any

      turbineCache.set(cacheKey, manifest)
      wasGenerated = true
    }

    // ── Webhook Notification ───────────────────────────────────────────
    sendWebhook('GAME_GENERATED', {
      gameName: manifest.name,
      appId,
      keyName: auth.apiKeyId,
      username: auth.user.username,
      userId: auth.user.id,
      plan: auth.user.plan,
      userAgent: request.headers.get('user-agent') || 'API Client'
    })

    if (!wasGenerated) {
      console.log(`[Request API] Serving ${appId} from storage cache (S3/Volume)`)
    }

    // Enrich usage log with what was requested
    enrichLog(auth.apiKeyId, 200, appId, manifest.name)

    // ── 6. Serve ───────────────────────────────────────────────────────────
    if (format === 'zip') {
      const { body, contentLength: streamLength } = await storage.getManifestStream(appId)
      
      if (!body) {
        return NextResponse.json(
          { error: `ZIP not found for App ID ${appId}.` },
          { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
        )
      }

      prisma.manifest.update({
        where: { id: manifest.id },
        data: { downloads: { increment: 1 } },
      }).catch(() => {})

      const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64)
      const contentLength = streamLength || (manifest.fileSize ? Number(manifest.fileSize) : null)

      return new NextResponse(body, {
        headers: {
          ...apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')),
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${safeName}_${appId}.zip"`,
          ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
          'Cache-Control': 'private, max-age=3600',
        },
      })
    }

    // Default: JSON response
    if (!pubBase) {
      console.error('[request/[appId]] NEXT_PUBLIC_APP_URL is required in production')
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    return NextResponse.json(
      {
        success: true,
        generated: wasGenerated,
        manifest: {
          id: manifest.id,
          appId: manifest.steamAppId,
          name: manifest.name,
          description: manifest.description,
          imageUrl: manifest.imageUrl,
          tags: manifest.tags,
          version: manifest.version,
          downloads: manifest.downloads,
          fileSize: manifest.fileSize ? Number(manifest.fileSize) : null,
          downloadUrl: `${pubBase}/api/download/${appId}`,
          requestUrl: `${pubBase}/api/request/${appId}`,
          zipUrl: `${pubBase}/api/request/${appId}?format=zip`,
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
        },
        rateLimit: {
          remaining: auth.rateLimit.remaining,
          limit: auth.rateLimit.limit,
          resetAt: auth.rateLimit.resetAt,
        },
        dailyQuota: {
          remaining: auth.dailyQuota.remaining,
          limit: auth.dailyQuota.limit,
          resetAt: auth.dailyQuota.resetAt,
        },
      },
      { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  } catch (error) {
    console.error(`[/api/request/${appId}]`, error)
    enrichLog(auth.apiKeyId, 500, appId)
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Update the most-recent usage log row (created by authenticateApiKey) with app details. */
async function enrichLog(apiKeyId: string, status: number, appId?: string, appName?: string) {
  try {
    const entry = await prisma.apiUsage.findFirst({
      where: { apiKeyId },
      orderBy: { createdAt: 'desc' },
    })
    if (!entry) return
    await prisma.apiUsage.update({
      where: { id: entry.id },
      data: {
        status,
        requestedAppId: appId ?? null,
        requestedName: appName ?? null,
      },
    })
  } catch (error) {
    // Logger failures should not crash the request
  }
}
