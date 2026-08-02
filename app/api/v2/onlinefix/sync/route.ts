import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed } from '@/app/lib/auth'

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request)
  const headers = apiHeaders(auth?.rateLimit, auth?.dailyQuota, request.headers.get('Origin'))

  if (!auth) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401, headers })
  }

  if (!isApiAccessAllowed(auth)) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers })
  }

  const allowedPlans = ['RESELLER', 'BUSINESS', 'CUSTOM']
  if (!allowedPlans.includes(auth.user.plan)) {
    return NextResponse.json(
      { error: 'OnlineFix Sync requires Reseller plan or higher.' },
      { status: 403, headers }
    )
  }

  try {
    const { syncOnlineFixIndexFromS3, BUCKET_NAME } = require('@/scripts/lib/onlinefix-s3')

    if (!BUCKET_NAME) {
      return NextResponse.json(
        { error: 'OnlineFix S3 storage is not configured.' },
        { status: 500, headers }
      )
    }

    const result = await syncOnlineFixIndexFromS3({ prismaClient: prisma })

    return NextResponse.json({
      success: true,
      source: 's3',
      prefix: result.prefix,
      found: result.found,
      added: result.added,
      updated: result.updated,
      rateLimit: auth.rateLimit,
      dailyQuota: auth.dailyQuota,
    }, { headers })
  } catch (error: any) {
    console.error('[OnlineFix Sync Error]', error)
    return NextResponse.json({ error: 'Internal server error during sync.' }, { status: 500, headers })
  }
}
