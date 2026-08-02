import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { loadVerificationSession, writeVerificationAudit } from '@/app/lib/discord-verify-session'
import { checkVerifyFailureSpike } from '@/app/lib/verify-funnel'
import { detectVerificationAlts, discordSnowflakeToDate } from '@/app/lib/verify-alt-detection'
import {
  extractFriendDiscordIds,
  isSocialSdkRelationshipsAvailable,
  summarizeRelationshipsForStorage,
} from '@/app/lib/discord-social-sdk'
import { swapMemberVerificationRoles } from '@/app/lib/discord-member-roles'
import { persistDiscordOAuthTokens, ensureDiscordGuildMembership } from '@/app/lib/discord-oauth-tokens'
import {
  fetchDiscordConnections,
  fetchDiscordGuilds,
  fetchDiscordRelationships,
  fetchDiscordUserProfile,
} from '@/app/lib/discord-verify-oauth'
import {
  buildDiscordVerifyIntel,
  fetchDiscordGuildMember,
} from '@/app/lib/discord-verify-intel'
import { isVpnOrProxy } from '@/app/lib/vpn-proxy-check'
import { getClientIp, getClientCountry } from '@/app/lib/ip'
import { resolveIpGeo } from '@/app/lib/ip-geo'
import { postVerificationCompleteLog } from '@/app/lib/discord-verify-complete-log'
import { VerificationSessionStatus } from '@prisma/client'
import { getDiscordVerifyConfig } from '@/app/lib/discord-verify-config'
import { getPublicAppUrl } from '@/app/lib/public-app-url'
import { getDiscordCdnAvatarUrl } from '@/app/lib/discord-avatar'
import { clearWebSessionRevoke, markWebLogin } from '@/app/lib/web-session-revoke'
import { notifyVerificationSuccess } from '@/app/lib/discord-verify-success-notify'
import { notifyVerificationBlocked } from '@/app/lib/discord-verify-blocked-notify'
import { checkVerificationBlacklist } from '@/app/lib/verification-blacklist'
import {
  buildAltBlockMessage,
  evaluateVerificationAltBlock,
  getVerificationAltReviewState,
  getVerificationAltBlockPolicy,
  mergeVerificationAltReviewState,
} from '@/app/lib/verification-alt-policy'

export const dynamic = 'force-dynamic'

async function postAltAlert(input: {
  sessionId: string
  discordId: string
  username: string
  altMatchedUserIds: string[]
  flags: string[]
  ip: string
  blocked?: boolean
}) {
  const config = await getDiscordVerifyConfig()
  if (!config.botToken || !config.alertsChannelId || input.altMatchedUserIds.length === 0) return

  const matchedUsers = await prisma.user.findMany({
    where: { id: { in: input.altMatchedUserIds } },
    select: { discordId: true, username: true },
  })

  const baseUrl = getPublicAppUrl() || 'http://127.0.0.1:3000'
  const adminHint = input.blocked
    ? `Review in **Admin → Verification → Load audit log** and approve or reject session \`${input.sessionId}\`.`
    : 'Verification completed with alt signals — no block applied.'

  await fetch(`https://discord.com/api/v10/channels/${config.alertsChannelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      embeds: [
        {
          title: input.blocked ? 'Verification Alt Blocked' : 'Verification Alt Flag',
          color: input.blocked ? 0xef4444 : 0xf59e0b,
          description: input.blocked
            ? `User <@${input.discordId}> (${input.username}) was blocked by the alt policy.`
            : `User <@${input.discordId}> (${input.username}) completed verification with alt signals.`,
          fields: [
            { name: 'Flags', value: input.flags.join(', ') || 'none', inline: true },
            { name: 'IP', value: input.ip, inline: true },
            { name: 'Session', value: `\`${input.sessionId}\``, inline: false },
            {
              name: 'Matched accounts',
              value: matchedUsers.map((u) => `${u.username} (\`${u.discordId}\`)`).join('\n') || 'unknown',
            },
            { name: 'Staff action', value: adminHint, inline: false },
            { name: 'Discord invite', value: `${baseUrl}/discord`, inline: false },
          ],
        },
      ],
    }),
  }).catch((err) => console.error('[Verify] alt alert failed:', err))
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const signed = String(body.s || '')
  const fingerprint = body.fingerprint ? String(body.fingerprint) : null
  const canvasHash = body.canvasHash ? String(body.canvasHash) : null

  if (!signed) {
    return NextResponse.json({ error: 'Missing session' }, { status: 400 })
  }

  const loaded = await loadVerificationSession(signed)
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.reason }, { status: 400 })
  }

  const { session } = loaded
  if (session.status === VerificationSessionStatus.COMPLETED) {
    return NextResponse.json({ success: true, alreadyCompleted: true })
  }

  if (session.status !== VerificationSessionStatus.OAUTH_COMPLETE || !session.oauthAccessToken) {
    return NextResponse.json({ error: 'oauth_required' }, { status: 400 })
  }

  const ip = getClientIp(request)
  const country = getClientCountry(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  const isVpn = await isVpnOrProxy(request, ip)
  if (isVpn) {
    await prisma.discordVerificationSession.update({
      where: { id: session.id },
      data: { vpnDetected: true, status: VerificationSessionStatus.FAILED },
    })
    await writeVerificationAudit({
      sessionId: session.id,
      discordId: session.discordId,
      action: 'VPN_BLOCKED',
      flags: ['vpn'],
      details: { ip, country },
    })
    void checkVerifyFailureSpike()
    return NextResponse.json({ code: 'VPN_BLOCKED', error: 'VPN or proxy detected. Disable it and try again.' }, { status: 403 })
  }

  const accessToken = session.oauthAccessToken
  const [profile, connectionsResult, guildsResult, guildMemberResult, relationshipsResult] = await Promise.all([
    fetchDiscordUserProfile(accessToken),
    fetchDiscordConnections(accessToken),
    fetchDiscordGuilds(accessToken),
    fetchDiscordGuildMember(accessToken, session.guildId),
    fetchDiscordRelationships(accessToken),
  ])
  const connections = connectionsResult.data
  const guilds = guildsResult.data
  const guildMember = guildMemberResult.data
  const relationships = relationshipsResult.ok ? relationshipsResult.data : []
  const friendDiscordIds = extractFriendDiscordIds(relationships, profile.id)
  const relationshipsSnapshot = relationshipsResult.ok
    ? summarizeRelationshipsForStorage(relationships)
    : null
  const socialSdkEnabled = isSocialSdkRelationshipsAvailable(relationshipsResult)

  const guildNameById = Object.fromEntries(
    guilds
      .map((guild) => {
        const id = String((guild as { id?: string }).id || '').trim()
        const name = String((guild as { name?: string }).name || '').trim()
        return id ? [id, name || `Server ${id}`] : null
      })
      .filter(Boolean) as Array<[string, string]>,
  )

  const blacklist = await checkVerificationBlacklist({
    friendDiscordIds,
    guildIds: guilds.map((guild) => String((guild as { id?: string }).id || '')).filter(Boolean),
    guildNames: guildNameById,
  })

  if (blacklist.blocked) {
    await prisma.discordVerificationSession.update({
      where: { id: session.id },
      data: {
        status: VerificationSessionStatus.FAILED,
        riskFlags: {
          blacklistHits: blacklist.hits,
        },
      },
    })
    await writeVerificationAudit({
      sessionId: session.id,
      discordId: session.discordId,
      action: 'BLACKLIST_BLOCKED',
      flags: blacklist.hits.map((hit) => hit.kind),
      details: { hits: blacklist.hits },
    })
    void checkVerifyFailureSpike()
    void notifyVerificationBlocked({
      discordId: profile.id,
      hits: blacklist.hits,
    }).catch((err) => console.error('[Verify] blocked notify failed:', err))

    return NextResponse.json(
      {
        code: 'VERIFICATION_BLOCKED',
        error: blacklist.message,
        hits: blacklist.hits,
      },
      { status: 403 },
    )
  }

  let verifyCountry = country
  let geoFallback: Awaited<ReturnType<typeof resolveIpGeo>> = null
  if (verifyCountry === 'XX' && ip !== 'unknown') {
    geoFallback = await resolveIpGeo(ip)
    if (geoFallback?.country) verifyCountry = geoFallback.country
  }

  const altResult = await detectVerificationAlts({
    discordId: profile.id,
    ip,
    fingerprint,
    email: profile.email,
    friendDiscordIds,
  })

  const avatarUrl = getDiscordCdnAvatarUrl(profile.id, profile.avatar, 128)
  const accountCreatedAt = discordSnowflakeToDate(profile.id)
  const intel = buildDiscordVerifyIntel({
    profile,
    connections,
    guilds,
    guildMember,
    relationships,
    accountCreatedAt,
  })

  const altPolicy = await getVerificationAltBlockPolicy()
  const altBlock = evaluateVerificationAltBlock(altResult, altPolicy)
  const altReview = getVerificationAltReviewState(session.riskFlags)
  const altApproved = altReview?.status === 'approved'
  if (altBlock.blocked && !altApproved) {
    const altAccounts = await prisma.user.findMany({
      where: { id: { in: altResult.altMatchedUserIds } },
      select: { username: true, discordId: true },
    })
    const message = buildAltBlockMessage(altBlock.blockedFlags)
    const pendingAltReview = {
      status: 'pending' as const,
      requestedAt: altReview?.requestedAt || new Date().toISOString(),
      mode: altBlock.mode,
      blockedFlags: altBlock.blockedFlags,
      matchedFlags: altBlock.matchedFlags,
    }

    await prisma.discordVerificationSession.update({
      where: { id: session.id },
      data: {
        status: VerificationSessionStatus.OAUTH_COMPLETE,
        verifyIp: ip,
        verifyCountry,
        verifyUserAgent: userAgent,
        verifyFingerprint: fingerprint,
        verifyCanvasHash: canvasHash,
        altMatchedUserIds: altResult.altMatchedUserIds,
        riskFlags: {
          ...mergeVerificationAltReviewState(session.riskFlags, pendingAltReview),
          flags: altResult.flags,
          altBlock: { mode: altBlock.mode, blockedFlags: altBlock.blockedFlags, matchedFlags: altBlock.matchedFlags },
          canvasHash,
          socialSdkEnabled,
          socialGraphMatches: altResult.socialGraphMatches,
        },
        discordIntelSnapshot: intel as any,
      },
    })

    await writeVerificationAudit({
      sessionId: session.id,
      discordId: profile.id,
      action: 'ALT_BLOCKED',
      flags: altBlock.blockedFlags,
      details: {
        ip,
        country: verifyCountry,
        policyMode: altBlock.mode,
        matchedFlags: altBlock.matchedFlags,
        blockedFlags: altBlock.blockedFlags,
        altMatchedUserIds: altResult.altMatchedUserIds,
        socialSdkEnabled,
        socialGraphMatches: altResult.socialGraphMatches?.slice(0, 20),
      },
    })
    void checkVerifyFailureSpike()
    await postAltAlert({
      sessionId: session.id,
      discordId: profile.id,
      username: profile.username,
      altMatchedUserIds: altResult.altMatchedUserIds,
      flags: altBlock.blockedFlags,
      ip,
      blocked: true,
    })

    return NextResponse.json(
      {
        code: 'ALT_BLOCKED',
        error: message,
        reviewPending: true,
        altFlags: altResult.flags,
        blockedFlags: altBlock.blockedFlags,
        altDetected: altAccounts.length > 0,
        altAccounts: altAccounts.map((u) => ({ username: u.username, discordId: u.discordId })),
      },
      { status: 403 },
    )
  }

  let user = await prisma.user.findUnique({ where: { discordId: profile.id } })

  const userData = {
    username: profile.username,
    discriminator: profile.discriminator || '0000',
    avatar: avatarUrl || '',
    email: profile.email || undefined,
    lastIp: ip,
    lastUserAgent: userAgent,
    fingerprint: fingerprint || undefined,
    country: verifyCountry,
    discordVerifiedAt: new Date(),
    verifyIp: ip,
    verifyCountry,
    verifyFingerprint: fingerprint || undefined,
    discordAccountCreatedAt: accountCreatedAt,
    discordConnections: connections as any,
    discordGuildsSnapshot: guilds as any,
    discordRelationshipsSnapshot: relationshipsSnapshot as any,
    discordGlobalName: profile.global_name || undefined,
    discordLocale: profile.locale || undefined,
    discordPremiumType: profile.premium_type ?? 0,
    discordMfaEnabled: !!profile.mfa_enabled,
    discordEmailVerified: !!profile.verified,
    discordPublicFlags: profile.public_flags ?? profile.flags ?? 0,
    discordProfileSnapshot: intel as any,
    discordAccessToken: accessToken,
    discordRefreshToken: session.oauthRefreshToken || undefined,
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        discordId: profile.id,
        ...userData,
      } as any,
    })
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: userData as any,
    })
  }

  await persistDiscordOAuthTokens(profile.id, accessToken, session.oauthRefreshToken)

  const guildEnsure = await ensureDiscordGuildMembership(profile.id, {
    accessToken,
    refreshToken: session.oauthRefreshToken,
    source: 'login',
  })

  let roleResult = await swapMemberVerificationRoles(profile.id, session.guildId)
  if (!roleResult.ok) {
    console.error('[Verify] role swap failed:', roleResult.error)
    if (guildEnsure.ok) {
      await new Promise((resolve) => setTimeout(resolve, 750))
      roleResult = await swapMemberVerificationRoles(profile.id, session.guildId)
      if (!roleResult.ok) {
        console.error('[Verify] role swap retry failed:', roleResult.error)
      }
    }
  }

  await prisma.discordVerificationSession.update({
    where: { id: session.id },
    data: {
      status: VerificationSessionStatus.COMPLETED,
      completedAt: new Date(),
      verifyIp: ip,
      verifyCountry,
      verifyUserAgent: userAgent,
      verifyFingerprint: fingerprint,
      verifyCanvasHash: canvasHash,
      altMatchedUserIds: altResult.altMatchedUserIds,
      riskFlags: {
        flags: altResult.flags,
        canvasHash,
        socialSdkEnabled,
        socialGraphMatches: altResult.socialGraphMatches,
        ...(altApproved && altReview
          ? { altReview: { ...altReview, completedAt: new Date().toISOString() } }
          : {}),
      },
      discordIntelSnapshot: intel as any,
    },
  })

  await writeVerificationAudit({
    sessionId: session.id,
    discordId: profile.id,
    action: 'VERIFICATION_COMPLETE',
    flags: altResult.flags,
    details: {
      ip,
      country: verifyCountry,
      altMatchedUserIds: altResult.altMatchedUserIds,
      connectionsCount: connections.length,
      guildsCount: guilds.length,
      roleSwapOk: roleResult.ok,
      guildEnsureOk: guildEnsure.ok,
      connectionsFetchOk: connectionsResult.ok,
      guildsFetchOk: guildsResult.ok,
      guildMemberFetchOk: guildMemberResult.ok,
      relationshipsFetchOk: relationshipsResult.ok,
      relationshipsCount: relationships.length,
      socialSdkEnabled,
      friendDiscordIds: friendDiscordIds.slice(0, 50),
      socialGraphMatches: altResult.socialGraphMatches?.slice(0, 20),
      displayName: intel.profile.displayName,
      premium: intel.profile.premiumLabel,
      mfaEnabled: intel.profile.mfaEnabled,
      accountAgeDays: intel.profile.accountAgeDays,
      badges: intel.profile.badges,
      guildNick: guildMember?.nick ?? null,
      guildJoinedAt: guildMember?.joined_at ?? null,
    },
  })

  await Promise.all([
    clearWebSessionRevoke(profile.id),
    markWebLogin(profile.id),
  ])

  if (altResult.altMatchedUserIds.length > 0) {
    await postAltAlert({
      sessionId: session.id,
      discordId: profile.id,
      username: profile.username,
      altMatchedUserIds: altResult.altMatchedUserIds,
      flags: altResult.flags,
      ip,
    })
  }

  void postVerificationCompleteLog({
    request,
    profile,
    intel,
    connections,
    guilds,
    guildMember,
    connectionsResult,
    guildsResult,
    guildMemberResult,
    fingerprint,
    canvasHash,
    accountCreatedAt,
    altResult,
    roleSwapOk: roleResult.ok,
    roleSwapError: roleResult.ok ? undefined : roleResult.error,
    guildEnsure,
    geo: geoFallback
      ? {
          city: geoFallback.city,
          region: geoFallback.region,
          country: geoFallback.country,
          timezone: geoFallback.timezone,
        }
      : undefined,
    guildId: session.guildId,
  }).catch((err) => console.error('[Verify] complete log failed:', err))

  void notifyVerificationSuccess({
    discordId: profile.id,
    username: profile.global_name || profile.username,
    email: profile.email,
  }).catch((err) => console.error('[Verify] success notification failed:', err))

  const altAccounts =
    altResult.altMatchedUserIds.length > 0
      ? (
          await prisma.user.findMany({
            where: { id: { in: altResult.altMatchedUserIds } },
            select: { username: true, discordId: true },
          })
        ).map((u) => ({ username: u.username, discordId: u.discordId }))
      : []

  return NextResponse.json({
    success: true,
    altFlags: altResult.flags,
    roleSwapOk: roleResult.ok,
    altDetected: altAccounts.length > 0,
    altAccounts,
  })
}
