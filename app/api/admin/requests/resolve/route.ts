import { authOptions } from '@/app/lib/auth-options'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { fetchSteamAppList, searchSteamStoreByName } from '@/app/lib/steam-app-list'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string }
    })

    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'OWNER' && caller.role !== 'MODERATOR' && caller.role !== 'SENIOR_MODERATOR')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { requestId } = await request.json()
    if (!requestId) {
      return NextResponse.json({ error: 'requestId is required' }, { status: 400 })
    }

    const gameReq = await prisma.gameRequest.findUnique({ where: { id: requestId } })
    if (!gameReq) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    
    if (gameReq.appId) {
      return NextResponse.json({ error: 'Request already has an appId' }, { status: 400 })
    }

    // Fetch Steam App List (IStoreService — legacy GetAppList/v2 was removed by Valve)
    let apps: { appid: number; name: string }[] = []
    try {
      apps = await fetchSteamAppList()
    } catch (catalogueErr) {
      console.warn('[Resolve] Steam catalogue unavailable, trying store search:', catalogueErr)
      apps = await searchSteamStoreByName(gameReq.name)
      if (apps.length === 0) {
        return NextResponse.json(
          { error: 'Failed to fetch Steam app list. Configure STEAM_API_KEY or try again later.' },
          { status: 502 },
        )
      }
    }
    
    // Simple matching (case insensitive, remove some punctuation)
    const targetName = gameReq.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    
    let matchedAppId = null
    for (const app of apps) {
      const currentName = app.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (currentName === targetName) {
        matchedAppId = app.appid
        break
      }
    }
    
    if (!matchedAppId) {
      // Try relaxed matching
      for (const app of apps) {
        const currentName = app.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (currentName.includes(targetName) || targetName.includes(currentName)) {
            // Only if it's reasonably long to avoid false positives on short words
            if (currentName.length > 5 && targetName.length > 5) {
                matchedAppId = app.appid
                break
            }
        }
      }
    }
    
    if (!matchedAppId) {
      return NextResponse.json({ error: 'Could not find a matching AppID on Steam' }, { status: 404 })
    }

    const updatedRequest = await prisma.gameRequest.update({
      where: { id: requestId },
      data: { appId: String(matchedAppId) }
    })

    return NextResponse.json({ success: true, appId: updatedRequest.appId })
  } catch (error) {
    console.error('Error resolving AppID:', error)
    return NextResponse.json({ error: 'Failed to resolve AppID' }, { status: 500 })
  }
}
