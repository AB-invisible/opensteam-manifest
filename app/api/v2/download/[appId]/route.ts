import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'
import { prepareCleanManifestZip, manifestZipAttachmentHeaders } from '@/app/lib/deliver-manifest'

/**
 * GET /api/v2/download/[appId]
 * 
 * Path-based download route for consistency with other API endpoints.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const { appId  } = params

  // 1. Authenticate (Skip usage tracking for downloads as they are usually follow-up calls)
  const auth = await authenticateApiKey(request, { skipUsage: true })
  
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid API key provided in URL.' },
      { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }

  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  // 2. Validate app ID
  if (!appId || !/^\d+$/.test(appId)) {
    return NextResponse.json(
      { error: 'Invalid Steam App ID — must be numeric.' },
      { status: 400, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

  const extraHeaders = apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin'))

  // 3. Check manifest exists in database
  const manifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId }
  })

  if (!manifest) {
    // Attempt real-time fetch if not in DB (consistent with base download route)
    console.log(`[API Path Download] ${appId} not in DB. Attempting upstream proxy...`)
    const { fetchManifestZipWithPlanGates } = await import('@/app/lib/upstream-manifest-fetch')

    const up = await fetchManifestZipWithPlanGates(appId, auth.user)
    if (!up.ok && up.reason === 'forbidden') {
      return NextResponse.json(
        { error: 'Manifest not found and auto-gen not available for your plan.' },
        { status: 403, headers: extraHeaders }
      )
    }
    if (!up.ok) {
      return NextResponse.json(
        { error: `Manifest not found for App ID: ${appId} in any source.` },
        { status: 404, headers: extraHeaders }
      )
    }

    const cleanedBuffer = await prepareCleanManifestZip(appId, up.zipBuffer)
    if (!cleanedBuffer) {
      return NextResponse.json(
        { error: `Manifest not found for App ID: ${appId} in any source.` },
        { status: 404, headers: extraHeaders }
      )
    }

    return new NextResponse(new Uint8Array(cleanedBuffer), {
      headers: manifestZipAttachmentHeaders(`App_${appId}.zip`, cleanedBuffer, extraHeaders),
    })
  }

  // 4. Load from storage (or upstream fallback) and clean on serve
  let cleanedBuffer = await prepareCleanManifestZip(appId)

  if (!cleanedBuffer) {
    console.log(`[API Path Download] ${appId} not in storage. Fetching from upstream...`)
    const { fetchManifestZipWithPlanGates } = await import('@/app/lib/upstream-manifest-fetch')

    const up = await fetchManifestZipWithPlanGates(appId, auth.user)
    if (!up.ok && up.reason === 'forbidden') {
      return NextResponse.json(
        { error: 'Stored file missing and real-time fetch is not enabled for your plan (Ryuu / Morrenus).' },
        { status: 403, headers: extraHeaders }
      )
    }
    if (!up.ok) {
      return NextResponse.json(
        { error: `Zip file not found in storage for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: extraHeaders }
      )
    }

    cleanedBuffer = await prepareCleanManifestZip(appId, up.zipBuffer)
    if (!cleanedBuffer) {
      return NextResponse.json(
        { error: `Zip file not found in storage for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: extraHeaders }
      )
    }
  }

  // Increment download counter (fire-and-forget)
  prisma.manifest.update({
    where: { id: manifest.id },
    data: { downloads: { increment: 1 } }
  }).catch(() => {})

  const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64)

  return new NextResponse(new Uint8Array(cleanedBuffer), {
    headers: manifestZipAttachmentHeaders(`${safeName}_${appId}.zip`, cleanedBuffer, extraHeaders),
  })
}
