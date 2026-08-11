import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse, legacyCutoffResponse } from '@/app/lib/auth'
import { fetchManifestFromMorrenus } from '@/app/lib/morrenus'
import { fetchManifestFromRyuu } from '@/app/lib/ryuu'
import { canAccessRyuu, canUseMorrenusFallback } from '@/app/lib/config'
import { getPublicAppUrl } from '@/app/lib/public-app-url'
import { sendWebhook } from '@/app/lib/webhooks'
import { fetchSteamGameName } from '@/app/lib/manifest-filename'
import { prepareCleanManifestZip, manifestZipAttachmentHeaders } from '@/app/lib/deliver-manifest'

export async function GET(
  request: NextRequest,
  { params }: { params: { apiKey: string; appId: string } }
) { 
  const { apiKey, appId } = params

  // ── 1. Auth + rate limit ──────────────────────────────────────────────────
  const auth = await authenticateApiKey(request, apiKey)
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid API key provided in URL.' },
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }

  const cutoffDate = new Date('2026-07-05T00:00:00.000Z')
  if (new Date(auth.apiKey.createdAt) >= cutoffDate) {
    return legacyCutoffResponse(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin'))
  }
  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  // ── 2. Validate app ID ────────────────────────────────────────────────────
  if (!appId || !/^\d+$/.test(appId)) {
    enrichLog(auth.usageLogId, 400, appId)
    return NextResponse.json(
      { error: 'Invalid Steam App ID — must be numeric.' },
      { status: 400, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

  const format = new URL(request.url).searchParams.get('format') || 'json'
  const hasRyuuAccess = canAccessRyuu(auth.user)
  const hasMorrenusFallback = canUseMorrenusFallback(auth.user)

  try {
    const pubBase = getPublicAppUrl()

    // ── 3. Check database/cache ───────────────────────────────────────────
    let manifest = await prisma.manifest.findUnique({ where: { steamAppId: appId } })
    let wasGenerated = false

    const storage = await import('@/app/lib/storage')
    const fileExists = await storage.anyStorageZipExists(appId)

    // S3 (then local) is authoritative: if zip exists, we use it directly without a DB row
    if (fileExists && !manifest) {
      // Create a virtual manifest object for the response
      const size = await storage.getManifestZipSizeBytes(appId)
      manifest = {
        id: `gen-${appId}-${Date.now()}`,
        steamAppId: appId,
        name: `App ${appId}`, // Will try to improve with Steam API below if needed
        fileSize: BigInt(size ?? 0),
        updatedAt: new Date(),
        createdAt: new Date(),
      } as any
    }

    if (!fileExists) {
      if (!hasRyuuAccess) {
        if (!pubBase) {
          console.error('[apiKey/generate] NEXT_PUBLIC_APP_URL is required in production')
          enrichLog(auth.usageLogId, 500, appId)
          return NextResponse.json(
            { error: 'Server configuration error.' },
            { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
          )
        }
        enrichLog(auth.usageLogId, 403, appId)
        return NextResponse.json(
          {
            error: 'Manifest not yet available for this App ID.',
            hint: 'Upstream auto-generation is not enabled for your plan unless an administrator turns on Ryuu/Morrenus. The Free plan includes it by default.',
            upgradeUrl: `${pubBase}/pricing`,
          },
          { status: 403, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
        )
      }

      // No zip in S3 or local: Ryuu first, then Morrenus (RESELLER+)
      console.log(`[API Generate] No manifest zip in storage for ${appId}. Fetching from Ryuu...`)
      let result = await fetchManifestFromRyuu(appId)

      if (!result.success && hasMorrenusFallback) {
        console.log(`[API Generate] Ryuu failed for ${appId}. Falling back to Morrenus...`)
        const ryuuErr = result.error
        result = await fetchManifestFromMorrenus(appId)

        if (!result.success || !result.zipBuffer) {
          console.error(`[API Generate] All upstream sources failed for ${appId}`)
          enrichLog(auth.usageLogId, 404, appId)
          return NextResponse.json(
            {
              error: 'Manifest not found in any upstream source.',
              hint: 'Please request this game via the dashboard if it is a valid Steam title.',
              details: { ryuu: ryuuErr, morrenus: result.error }
            },
            { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
          )
        }
      }

      if (!result.success || !result.zipBuffer) {
        enrichLog(auth.usageLogId, 404, appId)
        return NextResponse.json(
          {
            error: 'Manifest not found via upstream API.',
            hint: 'Enable Morrenus or Ryuu via plan overrides, or use the Free tier where both are on by default.',
            details: { ryuu: result.error }
          },
          { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
        )
      }

      const gameName = (await fetchSteamGameName(appId)) || `App ${appId}`

      // Persist to storage but DO NOT write to DB
      await storage.persistManifest(appId, result.zipBuffer)
      
      manifest = {
        id: `gen-${appId}-${Date.now()}`,
        steamAppId: appId,
        name: gameName,
        fileSize: BigInt(result.zipBuffer.length),
        updatedAt: new Date(),
        createdAt: new Date(),
      } as any
      
      wasGenerated = true
    }

    if (!manifest) {
      enrichLog(auth.usageLogId, 500, appId)
      return NextResponse.json(
        { error: 'Manifest could not be resolved.' },
        { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    await sendWebhook('GAME_GENERATED', {
      gameName: manifest.name, 
      appId, 
      keyName: auth.apiKeyId, 
      username: auth.user.username,
      userId: auth.user.id, 
      plan: auth.user.plan, 
      userAgent: request.headers.get('user-agent') || 'API Path'
    })

    if (!wasGenerated) {
      console.log(`[API Generate] Serving ${appId} from storage cache (S3/Volume)`)
    }

    if (format === 'zip') {
      const cleanedBuffer = await prepareCleanManifestZip(appId)

      if (!cleanedBuffer) {
        enrichLog(auth.usageLogId, 404, appId)
        return NextResponse.json(
          { error: `Zip file not found for app ID: ${appId}` },
          { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
        )
      }

      enrichLog(auth.usageLogId, 200, appId, manifest.name)
      prisma.manifest.update({ where: { id: manifest.id }, data: { downloads: { increment: 1 } } }).catch(() => {})
      const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64)

      return new NextResponse(new Uint8Array(cleanedBuffer), {
        headers: manifestZipAttachmentHeaders(
          `${safeName}_${appId}.zip`,
          cleanedBuffer,
          apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')),
        ),
      })
    }

    if (!pubBase) {
      console.error('[apiKey/generate] NEXT_PUBLIC_APP_URL is required in production')
      enrichLog(auth.usageLogId, 500, appId)
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    enrichLog(auth.usageLogId, 200, appId, manifest.name)
    return NextResponse.json(
      {
        success: true,
        generated: wasGenerated,
        manifest: {
          id: manifest.id, appId: manifest.steamAppId, name: manifest.name,
          downloadUrl: `${pubBase}/api/${apiKey}/download/${appId}`,
          updatedAt: manifest.updatedAt,
        },
        rateLimit: { remaining: auth.rateLimit.remaining, limit: auth.rateLimit.limit, resetAt: auth.rateLimit.resetAt },
        usage: { remaining: auth.dailyQuota.remaining, limit: auth.dailyQuota.limit, resetAt: auth.dailyQuota.resetAt },
      },
      { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  } catch (error) {
    enrichLog(auth.usageLogId, 500, appId)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  }
}

async function enrichLog(usageLogId: string | undefined, status: number, appId?: string, appName?: string) {
  if (!usageLogId) return
  try {
    await prisma.apiUsage.update({
      where: { id: usageLogId },
      data: { status, requestedAppId: appId ?? null, requestedName: appName ?? null }
    })
  } catch (error) {
    // Silent catch as per original logic
  }
}
