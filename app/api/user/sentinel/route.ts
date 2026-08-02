import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getToken } from 'next-auth/jwt'
import { authOptions } from '@/app/lib/auth-options'
import { Sentinel } from '@/app/lib/sentinel'
import { prisma } from '@/app/lib/prisma'
import { getClientIp } from '@/app/lib/ip'
import { assertWebActivityFresh, touchWebActivity } from '@/app/lib/session-inactivity'
import { assertWebSessionNotRevoked } from '@/app/lib/web-session-revoke'
import {
  ensureDiscordGuildMembershipThrottled,
  shouldAttemptGuildEnsure,
} from '@/app/lib/discord-oauth-tokens'

/**
 * POST /api/user/sentinel
 * Heartbeat endpoint for browser-level telemetry (fingerprinting/scraping detection).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessionUser = session.user as any
  const jwt = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })
  const discordId = String(jwt?.discordId || sessionUser.discordId || '').trim()
  if (!discordId) {
    return NextResponse.json({ error: 'Missing Discord identity' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  
  const ctx = {
    userId: discordId,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent') || 'unknown',
    fingerprint: body.fingerprint,
    canvasHash: body.canvasHash
  }

  const dbUser = await prisma.user.findUnique({
    where: { discordId },
  }) as any

  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const revokeCheck = assertWebSessionNotRevoked(dbUser)
  if (!revokeCheck.ok) {
    return NextResponse.json({ reason: revokeCheck.reason }, { status: 401 })
  }

  const activityCheck = assertWebActivityFresh(dbUser)
  if (!activityCheck.ok) {
    return NextResponse.json({ reason: 'inactivity' }, { status: 401 })
  }

  // 1. Process with Sentinel
  const sentinel = await Sentinel.checkRequest({
    userId: dbUser.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    fingerprint: ctx.fingerprint
  })

  // 2. Update user fingerprint if missing
  if (ctx.fingerprint && !dbUser.fingerprint) {
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { fingerprint: ctx.fingerprint } as any
    })
  }

  if (sentinel.blocked) {
    return NextResponse.json({ 
      blocked: true, 
      reason: sentinel.reason || 'Security validation failed.' 
    }, { status: 403 })
  }

  await touchWebActivity(dbUser.id)

  const guildTokenOpts = {
    accessToken: jwt?.accessToken as string | undefined,
    refreshToken: jwt?.refreshToken as string | undefined,
  }
  if (await shouldAttemptGuildEnsure(discordId, guildTokenOpts)) {
    await ensureDiscordGuildMembershipThrottled(dbUser.id, discordId, {
      ...guildTokenOpts,
      source: 'background',
    }).catch((err) => {
      console.error('[Sentinel] Guild ensure error:', err)
    })
  }

  return NextResponse.json({ 
    success: true,
    status: 'Sentinel Active'
  })
}
