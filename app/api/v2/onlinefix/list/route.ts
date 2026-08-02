import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKeyOrAdmin, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'

/**
 * GET /api/v2/onlinefix/list
 * 
 * Returns a list of all indexed OnlineFix games.
 */
export async function GET(request: NextRequest) {
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

  try {
    const games = await prisma.onlineFixGame.findMany({
      select: {
        name: true,
        fileName: true,
        fileSize: true,
        searches: true,
        lastUpdated: true,
      },
      orderBy: {
        name: 'asc'
      }
    })

    return NextResponse.json(
      { 
        success: true,
        count: games.length,
        games 
      },
      { status: 200, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  } catch (error: any) {
    console.error('[API OnlineFix List] Error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }
}
