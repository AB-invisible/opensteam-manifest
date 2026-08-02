import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiAccessDenialMeta, apiRateLimitResponse } from '@/app/lib/auth'
import { Plan } from '@prisma/client'

const BULK_PLANS: Plan[] = ['RESELLER', 'BUSINESS', 'CUSTOM']
const MAX_BULK = 25

/**
 * POST /api/{apiKey}/bulk/generate
 * Queue bulk manifest generation for reseller+ plans.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { } }
) {
  
  const auth = await authenticateApiKey(request)
  const headers = apiHeaders(auth?.rateLimit, auth?.dailyQuota, request.headers.get('Origin'))

  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401, headers })
  }

  if (!isApiAccessAllowed(auth)) {
    return apiRateLimitResponse(auth, request.headers.get('Origin'))
  }

  if (!BULK_PLANS.includes(auth.user.plan)) {
    return NextResponse.json(
      { error: 'Bulk generate requires Reseller plan or higher.' },
      { status: 403, headers }
    )
  }

  const body = await request.json().catch(() => ({}))
  const appIds: unknown = body.appIds
  if (!Array.isArray(appIds) || appIds.length === 0) {
    return NextResponse.json({ error: 'appIds array is required.' }, { status: 400, headers })
  }

  if (appIds.length > MAX_BULK) {
    return NextResponse.json({ error: `Maximum ${MAX_BULK} app IDs per request.` }, { status: 400, headers })
  }

  const pubBase = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const results: { appId: string; status: string; downloadUrl?: string; error?: string }[] = []

  for (const raw of appIds) {
    const appId = String(raw).trim()
    if (!/^\d+$/.test(appId)) {
      results.push({ appId, status: 'error', error: 'Invalid numeric App ID.' })
      continue
    }

    if (!isApiAccessAllowed(auth)) {
      const denial = apiAccessDenialMeta(auth)
      results.push({ appId, status: 'error', error: denial.message })
      break
    }

    try {
      const fetchHeaders: HeadersInit = { 'X-Internal-Bulk': '1' }
      const authHeader = request.headers.get('Authorization')
      const xApiKey = request.headers.get('X-API-Key')
      if (authHeader) fetchHeaders['Authorization'] = authHeader
      if (xApiKey) fetchHeaders['X-API-Key'] = xApiKey

      const genRes = await fetch(`${pubBase}/api/v2/generate/${appId}`, {
        headers: fetchHeaders,
      })
      const data = await genRes.json().catch(() => ({}))
      if (!genRes.ok) {
        results.push({ appId, status: 'error', error: data.error || 'Generation failed.' })
      } else {
        results.push({
          appId,
          status: 'ok',
          downloadUrl: data.manifest?.downloadUrl || `${pubBase}/api/v2/download/${appId}`,
        })
      }
    } catch {
      results.push({ appId, status: 'error', error: 'Request failed.' })
    }
  }

  return NextResponse.json({
    success: true,
    queued: results.length,
    results,
    rateLimit: auth.rateLimit,
    dailyQuota: auth.dailyQuota,
  }, { headers })
}
