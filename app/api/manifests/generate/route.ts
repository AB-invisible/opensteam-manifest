import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'
import { fetchManifestFromMorrenus } from '@/app/lib/morrenus'
import { fetchManifestFromRyuu } from '@/app/lib/ryuu'

import { getWebDailyLimit, canAccessRyuu, canUseMorrenusFallback } from '@/app/lib/config'
import { buildRateLimitDenial } from '@/app/lib/rate-limit-denial'
import { checkWebDailyQuota, webQuotaHeaders } from '@/app/lib/ratelimit'
import { getPublicAppUrl } from '@/app/lib/public-app-url'
import { Plan } from '@prisma/client'
import { sendWebhook } from '@/app/lib/webhooks'
import { resolveAndUpsertManifestName } from '@/app/lib/manifest-name-resolve'
import { assertDiscordGuildAccess } from '@/app/lib/discord-guild-restrictions'
import {
  buildGenerationAltBlockMessage,
  findVerifiedAltForGeneration,
} from '@/app/lib/generation-alt-gate'

/**
 * POST /api/manifests/generate
 *
 * Web-UI generation — Discord session required.
 * Fetches the manifest ZIP from the Morrenus API, stores it,
 * and records the generation for daily rate-limiting.
 * No self-generation — ZIP always comes from Morrenus.
 */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in required' },
        { status: 401, headers }
      )
    }

    const { appId, gameInfo, consumeApiQuota } = await request.json()
    if (!appId) {
      return NextResponse.json({ error: 'appId is required' }, { status: 400, headers })
    }

    const genConfig = await prisma.systemConfig.findUnique({ where: { key: 'GENERATION_ENABLED' } });
    if (genConfig && genConfig.value === 'false') {
      return NextResponse.json({ error: 'Generation is currently locked for maintenance.' }, { status: 503, headers })
    }

    // ── Resolve user ─────────────────────────────────────────────────────────
    let user = await prisma.user.findUnique({
      where: { discordId: session.user.discordId as string },
    })
    if (!user) {
      // Check if new registrations are allowed
      const regConfig = await prisma.systemConfig.findUnique({ where: { key: 'REGISTRATION_ENABLED' } })
      const registrationEnabled = regConfig ? regConfig.value === 'true' : true
      if (!registrationEnabled) {
        return NextResponse.json({ error: 'New account registrations are currently closed.' }, { status: 403, headers })
      }

      user = await prisma.user.create({
        data: {
          discordId: session.user.discordId as string,
          username: session.user.name || 'Unknown',
          discriminator: '0000',
          avatar: session.user.image || '',
          email: session.user.email || '',
        },
      })

      // Notify about new user signup
      const { username, id, avatar } = user
      sendWebhook('USER_SIGNUP', { username, userId: id, avatar })
    }

    const guildAccess = assertDiscordGuildAccess(user)
    if (!guildAccess.ok) {
      return NextResponse.json({ error: guildAccess.error, code: guildAccess.code }, { status: 403, headers })
    }

    if (!user.discordVerifiedAt) {
      return NextResponse.json(
        {
          error: 'Discord verification required before generating manifests.',
          code: 'NOT_VERIFIED',
        },
        { status: 403, headers },
      )
    }

    const altMatch = await findVerifiedAltForGeneration(user)
    if (altMatch) {
      return NextResponse.json(
        {
          error: buildGenerationAltBlockMessage(altMatch),
          code: 'ALT_NETWORK',
        },
        { status: 403, headers },
      )
    }

    // ── Daily limit check ────────────────────────────────────────────────────
    const webQuota = await checkWebDailyQuota(user.id, user)
    const { todayCount, limit: dailyWebLimit } = webQuota
    const webExhaustedAtStart = !webQuota.allowed

    if (webExhaustedAtStart) {
      const { sumApiQuotaRemainingAcrossKeys, consumeOneApiQuotaForWebGeneration } = await import(
        '@/app/lib/ratelimit'
      )
      const { getApiDailyLimit } = await import('@/app/lib/config')
      const { webRateLimitResponse } = await import('@/app/lib/rate-limit-denial')

      if (!consumeApiQuota) {
        const { totalRemaining, keyCount } = await sumApiQuotaRemainingAcrossKeys(user.id, user)
        const apiDailyLimitPerKey = getApiDailyLimit(user)
        const denial = buildRateLimitDenial(
          'WEB_DAILY_QUOTA',
          webQuota.errorReason || `Daily web generation limit reached (${todayCount}/${dailyWebLimit}).`,
          { resetAt: webQuota.resetAt, limit: dailyWebLimit, remaining: 0, scope: 'web' }
        )
        return webRateLimitResponse(
          denial,
          {
            todayCount,
            dailyWebLimit,
            apiQuotaRemaining: totalRemaining,
            apiDailyLimitPerKey,
            hasApiKeys: keyCount > 0,
          },
          { ...headers, ...webQuotaHeaders(webQuota) }
        )
      }

      const traded = await consumeOneApiQuotaForWebGeneration(user)
      if (!traded.ok) {
        const denial = buildRateLimitDenial(
          traded.code === 'NO_KEYS' ? 'NO_API_KEYS' : 'API_QUOTA_EXHAUSTED',
          traded.code === 'NO_KEYS'
            ? 'No API keys on your account. Create one in the Dashboard to trade API quota for web generations.'
            : 'No API quota remaining on any key to trade for this web generation.',
          { scope: 'web' }
        )
        return webRateLimitResponse(denial, undefined, { ...headers, ...webQuotaHeaders(webQuota) })
      }
    }

    const baseUrl = getPublicAppUrl()
    if (!baseUrl) {
      console.error('[manifests/generate] NEXT_PUBLIC_APP_URL is required in production')
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500, headers })
    }

    // ── 1. Check local DB and storage first ─────────────────────────────────
    if (!webExhaustedAtStart && todayCount + 1 >= dailyWebLimit) {
      sendWebhook('LIMIT_REACHED', {
        username: user.username,
        userId: user.id,
        limit: dailyWebLimit
      })
    }
    const appIdStr = String(appId)
    const nsfwKeywords = ['nudity', 'sexual content', 'nsfw', 'hentai', 'sexual violence']
    const isNsfw = gameInfo?.genres?.some((g: any) => 
      nsfwKeywords.includes(g.description?.toLowerCase())
    ) || false

    if (isNsfw) {
      sendWebhook('NSFW_GENERATED', {
        gameName: gameInfo?.name || appIdStr,
        appId: appIdStr,
        username: user.username,
        userId: user.id
      })
      return NextResponse.json({ error: 'NSFW games are not permitted on this platform.' }, { status: 403, headers })
    }
    const existingManifest = await prisma.manifest.findUnique({ where: { steamAppId: appIdStr } })
    const storage = await import('@/app/lib/storage')
    const isCached = existingManifest && (await storage.anyStorageZipExists(appIdStr))

    const hasRyuuAccess = canAccessRyuu(user)
    const hasMorrenusFallback = canUseMorrenusFallback(user)

    if (isCached) {
      console.log(`[Generate] Serving ${appIdStr} from cache (Local/S3)`)
      // Track generation for stats even if cached
      prisma.webGeneration.create({
        data: { userId: user.id, appId: appIdStr, gameName: existingManifest.name, isNsfw },
      }).catch(() => { })

      // Notify about member generation activity
      await sendWebhook('GAME_GENERATED', {
        gameName: existingManifest.name,
        appId: appIdStr,
        username: user.username,
        userId: user.id,
        plan: user.plan,
        userAgent: request.headers.get('user-agent') || 'Browser'
      })

      return NextResponse.json(
        {
          success: true,
          manifest: {
            id: existingManifest.id,
            appId: appIdStr,
            name: existingManifest.name,
            downloadUrl: `${baseUrl}/api/download/${appIdStr}`,
            fileSize: Number(existingManifest.fileSize),
            createdAt: existingManifest.createdAt,
          },
          usage: { todayCount: todayCount + 1, dailyLimit: dailyWebLimit },
          fromCache: true
        },
        { headers }
      )
    }

    // ── 2. Fetch from External Sources ──────────────────────────────────────
    if (!hasRyuuAccess) {
      return NextResponse.json(
        {
          error: 'Manifest not available in local cache.',
          hint: 'Upstream generation (Ryuu/Morrenus) is off for your plan unless an administrator enables it. The Free plan includes it by default.',
          upgradeUrl: `${baseUrl}/pricing`,
        },
        { status: 403, headers }
      )
    }

    // Priority: Ryuu first, then Morrenus (Fallback for RESELLER+)
    console.log(`[Generate] ${appIdStr} NOT in S3. Fetching from Ryuu...`)
    let result = await fetchManifestFromRyuu(appIdStr)
    let source = 'RYUU'

    if (!result.success && hasMorrenusFallback) {
      console.log(`[Generate] Ryuu failed for ${appIdStr}. Falling back to Morrenus...`)
      const ryuuErr = result.error
      const ryuuStatus = result.statusCode

      result = await fetchManifestFromMorrenus(appIdStr)
      source = 'MORRENUS'

      if (!result.success || !result.zipBuffer) {
        console.error(`[Generate] All upstream sources failed for ${appIdStr}`)
        const isNotFound = (ryuuStatus === 404 || ryuuErr?.includes('status 404')) &&
          (result.statusCode === 404 || result.error?.includes('returned status 404'))

        return NextResponse.json(
          {
            error: isNotFound ? `App ID ${appIdStr} not found in our upstream sources.` : (result.error || 'Failed to retrieve manifest from upstream APIs.'),
            hint: 'Generation is powered by Ryuu. If this is a valid game, please request it via the "Game Requests" tab.',
            isNotFound,
            details: { ryuu: ryuuErr, morrenus: result.error }
          },
          { status: isNotFound ? 404 : 502, headers }
        )
      }
    } else if (!result.success) {
      // Ryuu failed and NO fallback allowed
      const ryuuStatus = result.statusCode
      const isNotFound = ryuuStatus === 404 || result.error?.includes('status 404')

      return NextResponse.json(
        {
          error: isNotFound ? `App ID ${appIdStr} not found.` : 'Ryuu API returned an error.',
          hint: hasMorrenusFallback ? 'Try again later.' : 'Ryuu failed and Morrenus is not enabled for your plan.',
          isNotFound,
        },
        { status: isNotFound ? 404 : 502, headers }
      )
    }

    // ── 3. Persist file to storage (Direct S3 or local) ──────────────────────
    await storage.persistManifest(appIdStr, result.zipBuffer!)

    const gameName = await resolveAndUpsertManifestName(appIdStr, gameInfo?.name, user.id)
    const createdAt = new Date()

    // Track generation (fire-and-forget)
    prisma.webGeneration.create({
      data: { userId: user.id, appId: appIdStr, gameName, isNsfw },
    }).catch(() => { })

    // ── 4. Webhook notification ─────────────────────────────────────────────
    await sendWebhook('GAME_GENERATED', {
      gameName,
      appId: appIdStr,
      username: user.username,
      userId: user.id,
      plan: user.plan,
      userAgent: request.headers.get('user-agent') || 'Browser'
    })

    return NextResponse.json(
      {
        success: true,
        manifest: {
          id: `gen-${appIdStr}-${Date.now()}`,
          appId: appIdStr,
          name: gameName,
          downloadUrl: `${baseUrl}/api/download/${appIdStr}`,
          fileSize: result.zipBuffer!.length,
          createdAt: createdAt,
        },
        usage: { todayCount: todayCount + 1, dailyLimit: dailyWebLimit },
      },
      { headers }
    )
  } catch (error) {
    console.error('[/api/manifests/generate]', error)
    return NextResponse.json({ error: 'Failed to generate manifest' }, { status: 500, headers })
  }
}
