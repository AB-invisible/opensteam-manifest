import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse, legacyCutoffResponse } from '@/app/lib/auth'
import { getManifestStream, getManifestZipSizeBytes } from '@/app/lib/storage'
import { getS3PresignedUrl } from '@/app/lib/s3'

/**
 * GET /api/[apiKey]/download/[appId]
 * 
 * Path-based download route for consistency with other API endpoints.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { apiKey: string; appId: string } }
) {
  const { apiKey, appId } = params

  // 1. Authenticate (Skip usage tracking for downloads as they are usually follow-up calls)
  const auth = await authenticateApiKey(request, { providedKey: apiKey, skipUsage: true })
  
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

  // 2. Validate app ID
  if (!appId || !/^\d+$/.test(appId)) {
    return NextResponse.json(
      { error: 'Invalid Steam App ID — must be numeric.' },
      { status: 400, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }

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
        { status: 403, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }
    if (!up.ok) {
      return NextResponse.json(
        { error: `Manifest not found for App ID: ${appId} in any source.` },
        { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    // Return the upstream buffer directly
    const safeName = `App_${appId}`
    return new NextResponse(new Uint8Array(up.zipBuffer), {
      headers: {
        ...apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')),
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}.zip"`,
        'Content-Length': String(up.zipBuffer.length),
        'Cache-Control': 'private, max-age=3600',
      }
    })
  }

  // Check if manifest size is too big, redirect to S3 expiring link
  const sizeBytes = await getManifestZipSizeBytes(appId)
  if (sizeBytes && sizeBytes > 5 * 1024 * 1024) { // 5 MB threshold
    const s3Key = `manifests/${appId}/${appId}.zip`
    const presignedUrl = await getS3PresignedUrl(s3Key, 900) // 15 mins expiry
    
    if (presignedUrl) {
      console.log(`[API Download] ${appId} is ${sizeBytes} bytes. Redirecting to S3 presigned URL...`)
      
      // Increment download counter (fire-and-forget)
      prisma.manifest.update({
        where: { id: manifest.id },
        data: { downloads: { increment: 1 } }
      }).catch(() => {})
      
      const res = NextResponse.redirect(presignedUrl, 307)
      
      // Attach standard API headers to the redirect response
      const headers = apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin'))
      for (const [k, v] of Object.entries(headers)) {
        res.headers.set(k, String(v))
      }
      return res
    }
  }

  // 4. Get manifest stream (Local or S3)
  const { body, contentLength: streamLength } = await getManifestStream(appId)
  
  if (!body) {
    // Fallback: Proxy from upstream if not stored
    console.log(`[API Path Download] ${appId} not in storage. Fetching from upstream...`)
    const { fetchManifestZipWithPlanGates } = await import('@/app/lib/upstream-manifest-fetch')

    const up = await fetchManifestZipWithPlanGates(appId, auth.user)
    if (!up.ok && up.reason === 'forbidden') {
      return NextResponse.json(
        { error: 'Stored file missing and real-time fetch is not enabled for your plan (Ryuu / Morrenus).' },
        { status: 403, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }
    if (!up.ok) {
      return NextResponse.json(
        { error: `Zip file not found in storage for app ID: ${appId} and upstream fetch failed.` },
        { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64)
    return new NextResponse(new Uint8Array(up.zipBuffer), {
      headers: {
        ...apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')),
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}_${appId}.zip"`,
        'Content-Length': String(up.zipBuffer.length),
        'Cache-Control': 'private, max-age=3600',
      }
    })
  }

  const contentLength = streamLength || (manifest.fileSize ? Number(manifest.fileSize) : null)

  // Increment download counter (fire-and-forget)
  prisma.manifest.update({
    where: { id: manifest.id },
    data: { downloads: { increment: 1 } }
  }).catch(() => {})

  const safeName = manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64)
  
  // Use standard Web ReadableStream for Next.js 14 compatibility
  // Node.js 17+ supports Readable.toWeb()
  let responseBody: any = body;
  try {
    const streamModule = await import('stream');
    const Readable = streamModule.Readable || (streamModule as any).default?.Readable;
    
    if (typeof Readable === 'function' && body instanceof Readable) {
      if (typeof (Readable as any).toWeb === 'function') {
        responseBody = (Readable as any).toWeb(body);
      }
    }
  } catch (err) {
    console.warn('[API Download] Failed to convert Node stream to Web stream:', err);
  }

  return new NextResponse(responseBody, {
    headers: {
      ...apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')),
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}_${appId}.zip"`,
      ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
      'Cache-Control': 'private, max-age=3600',
    }
  })
}
