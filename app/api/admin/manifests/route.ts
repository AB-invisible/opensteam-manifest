import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { getStorageUsage, getFileSize } from '@/app/lib/storage'
import { countPlaceholderManifests } from '@/app/lib/platform-health'
import { isPlaceholderManifestName } from '@/app/lib/manifest-filename'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller || (caller.role !== 'OWNER' && caller.role !== 'ADMIN' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR')) {
      return NextResponse.json({ error: 'Forbidden. Owner, Admin or Moderator access required.' }, { status: 403, headers })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1') || 1
    const limit = parseInt(searchParams.get('limit') || '50') || 50
    const query = searchParams.get('query') || ''
    const skip = (page - 1) * limit

    const whereClause: any = {}
    if (query) {
      if (/^\d+$/.test(query)) {
        whereClause.OR = [
          { steamAppId: query },
          { name: { contains: query } }
        ]
      } else {
        whereClause.name = { contains: query }
      }
    }

    const [manifests, total] = await Promise.all([
      prisma.manifest.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          steamAppId: true,
          name: true,
          fileSize: true,
          downloads: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              username: true,
              avatar: true,
              discordId: true
            }
          }
        }
      }),
      prisma.manifest.count({ where: whereClause })
    ])

    const stats = await getStorageUsage()
    const placeholderCount = await countPlaceholderManifests()

    // Combine with FS checks for size (some might be out of sync in DB)
    const results = manifests.map(m => {
      const fsSize = getFileSize(m.steamAppId, `${m.steamAppId}.zip`)
      return {
        appId: m.steamAppId,
        name: m.name,
        isPlaceholderName: isPlaceholderManifestName(m.name),
        downloads: m.downloads,
        createdAt: m.createdAt,
        owner: m.user,
        sizeInStorage: fsSize || Number(m.fileSize || 0)
      }
    })

    return NextResponse.json({
      manifests: results,
      totalCount: total,
      page,
      totalPages: Math.ceil(total / limit),
      storage: stats,
      placeholderCount,
    }, { headers })
  } catch (error) {
    console.error('Error fetching admin manifests:', error)
    return NextResponse.json({ error: 'Failed to fetch manifest list' }, { status: 500, headers })
  }
}
