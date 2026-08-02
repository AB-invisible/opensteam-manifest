import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { authenticateApiKey, apiHeaders, isApiAccessAllowed, apiRateLimitResponse } from '@/app/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request)

    if (!auth) {
      return NextResponse.json(
        { error: 'Invalid or missing API key' },
        { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    if (!isApiAccessAllowed(auth)) {
      return apiRateLimitResponse(auth, request.headers.get('Origin'))
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const search = searchParams.get('search')

    const where = {
      userId: auth.user.id,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { steamAppId: { contains: search, mode: 'insensitive' as const } }
        ]
      })
    }

    const [manifests, total] = await Promise.all([
      prisma.manifest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.manifest.count({ where })
    ])

    return NextResponse.json({
      manifests: manifests.map((m: any) => ({
        id: m.id,
        steamAppId: m.steamAppId,
        name: m.name,
        description: m.description,
        downloads: m.downloads,
        fileSize: m.fileSize ? Number(m.fileSize) : null,
        downloadUrl: `/api/download/${m.steamAppId}`,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  } catch (error) {
    console.error('Error fetching user manifests:', error)
    return NextResponse.json(
      { error: 'Failed to fetch manifests' },
      { status: 500, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request)

    if (!auth) {
      return NextResponse.json(
        { error: 'Invalid or missing API key' },
        { status: 401, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
      )
    }

    if (!isApiAccessAllowed(auth)) {
      return apiRateLimitResponse(auth, request.headers.get('Origin'))
    }

    const { steamAppId, name, description, tags } = await request.json()

    if (!steamAppId) {
      return NextResponse.json(
        { error: 'Steam App ID is required' },
        { status: 400, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
      )
    }

    const manifest = await prisma.manifest.create({
      data: {
        id: String(steamAppId),
        steamAppId: String(steamAppId),
        name: name || `Manifest ${steamAppId}`,
        description,
        tags: tags || [],
        userId: auth.user.id
      }
    })

    // Announce to Telegram
    const { sendTelegramPublicPromo } = await import('@/app/lib/telegram-bot')
    await sendTelegramPublicPromo(`🎉 <b>New Game Released!</b>\n\n<b>${manifest.name}</b> has just been added to the OpenSteam database.\n\nAppID: <code>${manifest.steamAppId}</code>\nUploaded by: <code>${auth.user.username}</code>`, undefined, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 Download Now', url: `http://127.0.0.1:3000/manifest/${manifest.steamAppId}` }
        ]]
      }
    })

    return NextResponse.json({
      manifest: {
        id: manifest.id,
        steamAppId: manifest.steamAppId,
        name: manifest.name,
        downloadUrl: `/api/download/${manifest.steamAppId}`,
        createdAt: manifest.createdAt
      }
    }, { headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) })
  } catch (error) {
    console.error('Error creating manifest:', error)
    return NextResponse.json(
      { error: 'Failed to create manifest' },
      { status: 500, headers: apiHeaders(undefined, undefined, request.headers.get('Origin')) }
    )
  }
}
