import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { getClientIp } from '@/app/lib/ip'
import { canAccessRyuu, canUseMorrenusFallback } from '@/app/lib/config'
import { persistDiscordOAuthTokens, ensureDiscordGuildMembershipThrottled } from '@/app/lib/discord-oauth-tokens'
import { syncUserDiscordProfileFromApiThrottled } from '@/app/lib/discord-profile-sync'
import { assertWebActivityFresh, touchWebActivity } from '@/app/lib/session-inactivity'
import { assertWebSessionNotRevoked, markWebLogin } from '@/app/lib/web-session-revoke'
import { isDiscordGuildRestricted } from '@/app/lib/discord-guild-restrictions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))
  
  try {
    const session = await getServerSession(authOptions)
    
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      )
    }

    const ip = getClientIp(request)
    const userAgent = request.headers.get('user-agent') || 'unknown'
    const { searchParams } = new URL(request.url)
    const fingerprint = searchParams.get('fp')
    const { getClientCountry } = await import('@/app/lib/ip')
    const country = getClientCountry(request)

    // 1. Check if IP is blacklisted (Global Firewall)
    const { isIpBlacklisted } = await import('@/app/lib/ratelimit')
    if (await isIpBlacklisted(ip)) {
      return NextResponse.json({ error: 'Your connection is strictly prohibited.' }, { status: 403, headers })
    }

    let user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string },
    })

    if (user) {
      const revokeCheck = assertWebSessionNotRevoked(user)
      if (!revokeCheck.ok) {
        return NextResponse.json({ reason: revokeCheck.reason }, { status: 401, headers })
      }

      const activityCheck = assertWebActivityFresh(user)
      if (!activityCheck.ok) {
        return NextResponse.json({ reason: 'inactivity' }, { status: 401, headers })
      }
    }

    const jwt = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    })

    if (!user) {
      // Check if new registrations are allowed
      const regConfig = await prisma.systemConfig.findUnique({ where: { key: 'REGISTRATION_ENABLED' } })
      const registrationEnabled = regConfig ? regConfig.value === 'true' : true

      if (!registrationEnabled) {
        return NextResponse.json(
          { error: 'New account registrations are currently closed. Please try again later.', registrationClosed: true },
          { status: 403, headers }
        )
      }

      user = await prisma.user.create({
        data: {
          discordId: session.user.discordId as string,
          username: session.user.name || 'Unknown',
          discriminator: '0000',
          avatar: session.user.image || '',
          email: session.user.email || '',
          lastIp: ip,
          lastUserAgent: userAgent,
          fingerprint: fingerprint,
          country: country,
          discordAccessToken: (jwt?.accessToken as string | undefined) || undefined,
          discordRefreshToken: (jwt?.refreshToken as string | undefined) || undefined,
        } as any
      });

      const { ensureUserAntiPhishingCode } = await import('@/app/lib/anti-phishing');
      await ensureUserAntiPhishingCode(user.id).catch((err) =>
        console.error('[Anti-Phishing Code Init Error]', err)
      );

      // Trigger gorgeous welcome email & Discord welcome DM asynchronously
      const welcomeUserId = user.id;
      import('@/app/lib/email').then(({ sendWelcomeEmail }) => {
        sendWelcomeEmail(welcomeUserId).catch(err => console.error('[Welcome Email Trigger Error]', err));
      }).catch(err => console.error('[Welcome Email Import Error]', err));
    } else {
      // Update IP/UA/FP on every "me" hit — username comes from DB / Discord API sync, not stale JWT.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastIp: ip,
          lastUserAgent: userAgent,
          fingerprint: fingerprint || undefined,
          country: country
        } as any
      }).catch((e) => {
          return prisma.user.update({
            where: { id: user!.id },
            data: {
              lastIp: ip,
              lastUserAgent: userAgent,
              fingerprint: fingerprint || undefined
            } as any
          })
      }).catch((e) => console.error('Failed to update user login info:', e))
    }

    // Persist OAuth tokens from JWT when the user row existed before login or tokens were refreshed.
    if (jwt?.accessToken || jwt?.refreshToken) {
      await persistDiscordOAuthTokens(
        session.user.discordId as string,
        jwt.accessToken as string | undefined,
        jwt.refreshToken as string | undefined
      ).catch((e) => console.error('Failed to persist Discord OAuth tokens from JWT:', e))

      await ensureDiscordGuildMembershipThrottled(user.id, user.discordId, {
        accessToken: jwt.accessToken as string | undefined,
        refreshToken: jwt.refreshToken as string | undefined,
        source: 'login',
      }).catch((e) => console.error('Failed to ensure Discord guild membership:', e))
    }

    // Background sync — do not block the response (avoids starving /api/auth/session).
    void syncUserDiscordProfileFromApiThrottled({
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      avatar: user.avatar,
      discordAccessToken: (user as any).discordAccessToken ?? (jwt?.accessToken as string | undefined) ?? null,
      discordRefreshToken: (user as any).discordRefreshToken ?? (jwt?.refreshToken as string | undefined) ?? null,
    }).catch((e) => console.error('Failed to sync Discord profile from API:', e))

    await Promise.all([
      touchWebActivity(user.id).catch((e) => console.error('Failed to touch web activity:', e)),
      markWebLogin(user.discordId).catch((e) => console.error('Failed to mark web login:', e)),
    ])

    const isJailed = user.jailUntil && new Date() < new Date(user.jailUntil);
    if ((user as any).isBanned || isJailed) {
      return NextResponse.json(
        { 
          error: (user as any).isBanned ? 'Your account is permanently banned.' : 'Your account is temporarily suspended.',
          banned: true,
          jailed: isJailed,
          discordId: user.discordId
        },
        { status: 403, headers }
      )
    }

    const [apiKeys, manifests] = await Promise.all([
      prisma.apiKey.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          key: true,
          name: true,
          rateLimit: true,
          rateWindow: true,
          enabled: true,
          createdAt: true,
          lastUsed: true,
        }
      }),
      prisma.manifest.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          steamAppId: true,
          name: true,
          downloads: true,
          createdAt: true,
        }
      })
    ])

    const hasUpstreamAutoGen = canAccessRyuu(user) || canUseMorrenusFallback(user)

    return NextResponse.json({
      user: {
        id: user.id,
        discordId: user.discordId,
        username: user.username,
        avatar: user.avatar,
        email: user.email,
        role: user.role,
        plan: user.plan,
        planExpiry: user.planExpiry,
        planIsCanceled: user.planIsCanceled,
        createdAt: user.createdAt,
        hasUpstreamAutoGen,
        discordGuildRestricted: isDiscordGuildRestricted(user),
      },
      apiKeys,
      recentManifests: manifests
    }, { headers })
  } catch (error) {
    console.error('Error fetching user data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user data' },
      { status: 500, headers: corsHeaders(request.headers.get('Origin')) }
    )
  }
}
