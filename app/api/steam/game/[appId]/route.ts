import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { isMalicious } from '@/app/lib/security-patterns'
import { Sentinel } from '@/app/lib/sentinel'
import { getClientIp } from '@/app/lib/ip'
import { prisma } from '@/app/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { appId: string } }
) {
  const appId = params.appId
  const url = request.nextUrl.pathname + request.nextUrl.search
  const ip = getClientIp(request)
  
  // ── 0. Fast IP Blacklist Check ──────────────────────────────────────────
  const isBlacklisted = await prisma.blacklistedIp.findUnique({ where: { ip } })
  if (isBlacklisted) {
    return NextResponse.json(
      { error: 'Security Violation: Your network has been blacklisted for malicious activity.' },
      { status: 403 }
    )
  }

  // ── 1. Strict Validation ────────────────────────────────────────────────
  // App IDs must be purely numeric. If they contain ANYTHING else, it's an injection probe.
  if (!/^\d+$/.test(appId) || isMalicious(url)) {
    const session = await getServerSession(authOptions)
    
    let userId: string | undefined = undefined
    if (session?.user) {
      const dbUser = await prisma.user.findUnique({
        where: { discordId: (session.user as any).discordId }
      })
      userId = dbUser?.id
    }

    // Trigger Sentinel to jail the user and IP
    await Sentinel.checkRequest({
      userId,
      ip,
      userAgent: request.headers.get('user-agent') || 'unknown',
      payload: url
    })

    return NextResponse.json(
      { 
        error: 'Security Violation: Request contains illegal query commands or patterns.',
        code: 'SEC_VIOLATION' 
      }, 
      { status: 403 }
    )
  }
  
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}`
    )
    
    if (!response.ok) {
      throw new Error('Failed to fetch game data')
    }
    
    const data = await response.json()
    
    if (!data[appId] || !data[appId].success) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      )
    }
    
    const gameData = data[appId].data
    
    return NextResponse.json({
      name: gameData.name,
      header_image: gameData.header_image,
      short_description: gameData.short_description,
      steam_appid: gameData.steam_appid,
      release_date: gameData.release_date,
      developers: gameData.developers,
      publishers: gameData.publishers,
      genres: gameData.genres,
      categories: gameData.categories,
      platforms: gameData.platforms,
      price_overview: gameData.price_overview,
      screenshots: gameData.screenshots,
      movies: gameData.movies
    })
  } catch (error) {
    console.error('Error fetching Steam game data:', error)
    
    // If the request reached here but failed, and it looks weird, jail them
    const session = await getServerSession(authOptions)
    let userId: string | undefined = undefined
    if (session?.user) {
      const dbUser = await prisma.user.findUnique({
        where: { discordId: (session.user as any).discordId }
      })
      userId = dbUser?.id
    }

    await Sentinel.checkRequest({
      userId,
      ip,
      userAgent: request.headers.get('user-agent') || 'unknown',
      payload: url 
    })

    return NextResponse.json(
      { error: 'Security Violation: Internal failure during processing.' },
      { status: 500 }
    )
  }
}
