import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'
import { zipExists, getFileSize } from '@/app/lib/storage'

export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  try {
    const auth = await authenticateApiKey(request, { skipUsage: true })
    
    if (!auth) {
      return NextResponse.json(
        { error: 'Invalid or missing API key' },
        { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    if (!isApiAccessAllowed(auth)) {
      return apiRateLimitResponse(auth, request.headers.get('Origin'))
    }

    const appId = params.appId

    const manifest = await prisma.manifest.findFirst({
      where: {
        steamAppId: appId,
        userId: auth.user.id
      }
    })

    if (!manifest) {
      return NextResponse.json(
        { error: 'Manifest not found or access denied' },
        { status: 404, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    const storage = await import('@/app/lib/storage')
    const hasZip = await storage.anyStorageZipExists(appId)
    const fileSize = hasZip ? storage.getFileSize(appId, `${appId}.zip`) : null

    return NextResponse.json({
      manifest: {
        id: manifest.id,
        steamAppId: manifest.steamAppId,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        imageUrl: manifest.imageUrl,
        tags: manifest.tags,
        downloads: manifest.downloads,
        fileSize: fileSize,
        hasZip,
        downloadUrl: hasZip ? `/api/download/${appId}` : null,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt
      }
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  } catch (error) {
    console.error('Error fetching user files:', error)
    return NextResponse.json(
      { error: 'Failed to fetch files' },
      { status: 500, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }
}
