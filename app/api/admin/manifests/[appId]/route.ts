import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { deleteManifest, getFileSize } from '@/app/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const headers = corsHeaders(request.headers.get('Origin'))
  const { appId } = params

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

    if (!appId) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400, headers })
    }

    const manifest = await prisma.manifest.findFirst({
      where: { steamAppId: appId },
      include: {
        user: {
          select: {
            username: true,
            avatar: true,
            discordId: true
          }
        }
      }
    })

    if (!manifest) {
      return NextResponse.json({ error: 'Manifest not found' }, { status: 404, headers })
    }

    const fsSize = getFileSize(manifest.steamAppId, `${manifest.steamAppId}.zip`)

    return NextResponse.json({
      manifest: {
        appId: manifest.steamAppId,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        downloads: manifest.downloads,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        storageType: manifest.storageType,
        sizeInStorage: fsSize || Number(manifest.fileSize || 0),
        owner: manifest.user
      }
    }, { headers })
  } catch (error) {
    console.error(`Error fetching manifest ${appId}:`, error)
    return NextResponse.json({ error: 'Failed to fetch manifest' }, { status: 500, headers })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const headers = corsHeaders(request.headers.get('Origin'))
  const { appId } = params

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

    if (!appId) {
      return NextResponse.json({ error: 'App ID is required' }, { status: 400, headers })
    }

    console.log(`[Admin] Deleting manifest for AppID: ${appId}`)
    await deleteManifest(appId)

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: caller.id,
        action: 'DELETE_MANIFEST',
        details: { message: `Deleted manifest for AppID ${appId}` },
        ip: request.headers.get('x-forwarded-for') || '0.0.0.0'
      }
    })

    return NextResponse.json({ success: true, message: `Manifest ${appId} deleted successfully.` }, { headers })
  } catch (error) {
    console.error(`Error deleting manifest ${appId}:`, error)
    return NextResponse.json({ error: 'Failed to delete manifest' }, { status: 500, headers })
  }
}
