import type { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { getDiscordVerifyConfig } from '@/app/lib/discord-verify-config'
import type { DiscordFetchResult } from '@/app/lib/discord-verify-oauth'
import type { DiscordGuildMember, DiscordVerifyIntel } from '@/app/lib/discord-verify-intel'
import type { GuildMemberOAuthResult } from '@/app/lib/discord-oauth-tokens'
import { getSecurityContextFromRequest } from '@/app/lib/ip'
import type { AltDetectionResult } from '@/app/lib/verify-alt-detection'

type DiscordConnection = {
  type?: string
  name?: string
  id?: string
  verified?: boolean
  visibility?: number
}

type DiscordGuild = {
  id?: string
  name?: string
  owner?: boolean
}

function formatUsername(username: string, discriminator?: string) {
  if (discriminator && discriminator !== '0' && discriminator !== '0000') {
    return `${username}#${discriminator}`
  }
  return username
}

function formatApproxLocation(
  ctx: ReturnType<typeof getSecurityContextFromRequest>,
  geo?: { city?: string | null; region?: string | null; country?: string | null }
): string {
  const city = geo?.city ?? ctx.city
  const region = geo?.region ?? ctx.region
  const country = geo?.country ?? ctx.country
  const parts = [city, region, country].filter((part) => part && part !== 'XX') as string[]
  if (parts.length > 0) return parts.join(', ')
  if (country && country !== 'XX') return country
  return 'Unknown'
}

function formatFetchMeta(label: string, result: DiscordFetchResult<unknown[]>): string | null {
  if (result.ok) return null
  return `${label} API ${result.status || 'error'}: ${result.error.slice(0, 180)}`
}

function truncateField(value: string, max = 1000): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function formatConnectionsList(connections: unknown): string {
  if (!Array.isArray(connections) || connections.length === 0) {
    return 'None'
  }
  const lines = (connections as DiscordConnection[]).slice(0, 20).map((c) => {
    const type = c.type || 'unknown'
    const name = c.name || c.id || 'unnamed'
    const verified = c.verified ? ' ✓' : ''
    return `• ${type}: ${name}${verified}`
  })
  if (connections.length > 20) {
    lines.push(`… +${connections.length - 20} more (see attachment)`)
  }
  return lines.join('\n')
}

function formatGuildsList(guilds: unknown): string {
  if (!Array.isArray(guilds) || guilds.length === 0) {
    return 'None'
  }
  const lines = (guilds as DiscordGuild[]).slice(0, 25).map((g) => {
    const owner = g.owner ? ' (owner)' : ''
    return `• ${g.name || 'unknown'} (\`${g.id || '?'}\`)${owner}`
  })
  if (guilds.length > 25) {
    lines.push(`… +${guilds.length - 25} more (see attachment)`)
  }
  return lines.join('\n')
}

export async function postVerificationCompleteLog(input: {
  request: NextRequest
  profile: {
    id: string
    username: string
    discriminator?: string
    email?: string | null
  }
  intel: DiscordVerifyIntel
  connections: unknown
  guilds: unknown
  guildMember: DiscordGuildMember | null
  connectionsResult: DiscordFetchResult<unknown[]>
  guildsResult: DiscordFetchResult<unknown[]>
  guildMemberResult: DiscordFetchResult<DiscordGuildMember | null>
  fingerprint: string | null
  canvasHash: string | null
  accountCreatedAt: Date
  altResult: AltDetectionResult
  roleSwapOk: boolean
  roleSwapError?: string
  guildEnsure: GuildMemberOAuthResult
  geo?: { city?: string | null; region?: string | null; country?: string | null; timezone?: string | null }
  guildId: string
}): Promise<void> {
  const config = await getDiscordVerifyConfig()
  if (!config.botToken || !config.alertsChannelId) return

  const ctx = getSecurityContextFromRequest(input.request)
  const displayName = input.intel.profile.displayName
  const approxLocation = formatApproxLocation(ctx, input.geo)
  const resolvedCountry = input.geo?.country && input.geo.country !== 'XX' ? input.geo.country : ctx.country

  let altMatchesText = 'None'
  let altMatchedAccounts: Array<{ userId: string; username: string; discordId: string }> = []
  if (input.altResult.altMatchedUserIds.length > 0) {
    const matched = await prisma.user.findMany({
      where: { id: { in: input.altResult.altMatchedUserIds } },
      select: { id: true, username: true, discordId: true },
    })
    altMatchedAccounts = matched.map((u) => ({
      userId: u.id,
      username: u.username,
      discordId: u.discordId,
    }))
    altMatchesText =
      matched.map((u) => `${u.username} (\`${u.discordId}\`)`).join('\n') || 'unknown'
  }

  const apiWarnings = [
    formatFetchMeta('Connections', input.connectionsResult),
    formatFetchMeta('Guilds', input.guildsResult),
    !input.guildMemberResult.ok
      ? `Guild member API ${input.guildMemberResult.status || 'error'}: ${input.guildMemberResult.error.slice(0, 180)}`
      : null,
  ].filter(Boolean) as string[]

  const connectionsCount = input.intel.connections.total
  const guildsCount = input.intel.guilds.total
  const p = input.intel.profile

  const embed = {
    title: '✅ Verification completed',
    color: input.altResult.flags.length > 0 ? 0xf59e0b : 0x10b981,
    description: `<@${input.profile.id}> (${displayName}) passed OpenSteam verification.`,
    fields: [
      { name: 'Username', value: displayName, inline: true },
      { name: 'Discord ID', value: `\`${input.profile.id}\``, inline: true },
      {
        name: 'Display / @user',
        value: `@${p.username}`,
        inline: true,
      },
      {
        name: 'Used VPN or Proxy',
        value: 'No',
        inline: true,
      },
      { name: 'IP address', value: `\`${ctx.ip}\``, inline: true },
      { name: 'Approx. location', value: approxLocation, inline: true },
      {
        name: 'Email',
        value: p.email ? `\`${p.email}\`${p.emailVerified ? ' (verified)' : ''}` : 'Not provided',
        inline: true,
      },
      {
        name: 'Account created',
        value: `${p.accountCreatedAt.slice(0, 10)} (${p.accountAgeDays}d old)`,
        inline: true,
      },
      {
        name: 'Locale',
        value: p.locale || '—',
        inline: true,
      },
      {
        name: 'MFA',
        value: p.mfaEnabled ? 'Enabled' : 'Off',
        inline: true,
      },
      {
        name: 'Nitro',
        value: p.premiumLabel,
        inline: true,
      },
      {
        name: 'Badges',
        value: p.badges.length ? p.badges.join(', ') : 'None',
        inline: false,
      },
      {
        name: 'Guild member',
        value: input.guildMember
          ? [
              input.guildMember.nick ? `Nick: ${input.guildMember.nick}` : 'No server nick',
              input.guildMember.joined_at ? `Joined: ${input.guildMember.joined_at.slice(0, 10)}` : null,
              input.guildMember.premium_since ? `Server boosting since ${input.guildMember.premium_since.slice(0, 10)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'In guild'
          : 'Not in guild (or no guilds scope)',
        inline: false,
      },
      {
        name: 'Guild join (OAuth)',
        value: input.guildEnsure.ok
          ? input.guildEnsure.outcome === 'joined'
            ? 'Joined via OAuth'
            : 'Already in server'
          : input.guildEnsure.reason,
        inline: true,
      },
      {
        name: 'Roles updated',
        value: input.roleSwapOk
          ? 'Yes'
          : input.roleSwapError
            ? truncateField(input.roleSwapError, 200)
            : 'Failed',
        inline: true,
      },
      {
        name: 'Alt flags',
        value: input.altResult.flags.length ? input.altResult.flags.join(', ') : 'None',
        inline: true,
      },
      ...(input.altResult.socialGraphMatches.length > 0
        ? [
            {
              name: 'Social graph signals',
              value: truncateField(
                input.altResult.socialGraphMatches
                  .slice(0, 10)
                  .map((m) => `${m.username} (\`${m.discordId}\`): ${m.reasons.join(', ')}`)
                  .join('\n')
              ),
              inline: false,
            },
          ]
        : []),
      {
        name: 'Friends / relationships',
        value: input.intel.relationships
          ? [
              `${input.intel.relationships.friends} friends`,
              input.intel.relationships.blocked ? `${input.intel.relationships.blocked} blocked` : null,
              input.intel.relationships.pendingIncoming
                ? `${input.intel.relationships.pendingIncoming} pending incoming`
                : null,
              input.intel.relationships.pendingOutgoing
                ? `${input.intel.relationships.pendingOutgoing} pending outgoing`
                : null,
              input.intel.relationships.sampleUsernames.length
                ? `Sample: ${input.intel.relationships.sampleUsernames.slice(0, 8).join(', ')}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'None'
          : 'Not available — enable relationships.read (Social SDK) on your Discord app.',
        inline: false,
      },
      {
        name: `Linked connections (${connectionsCount}, ${input.intel.connections.verifiedCount} verified)`,
        value: truncateField(formatConnectionsList(input.connections)),
        inline: false,
      },
      {
        name: `Servers snapshot (${guildsCount}, owns ${input.intel.guilds.ownedCount})`,
        value: truncateField(formatGuildsList(input.guilds)),
        inline: false,
      },
      {
        name: 'Fingerprint',
        value: input.fingerprint ? `\`${input.fingerprint}\`` : '—',
        inline: false,
      },
      {
        name: 'Canvas hash',
        value: input.canvasHash ? `\`${input.canvasHash}\`` : '—',
        inline: true,
      },
      {
        name: 'User-Agent',
        value: truncateField(ctx.userAgent || input.request.headers.get('user-agent') || '—', 256),
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `Guild ${input.guildId} · OpenSteam Verify` },
  }

  if (apiWarnings.length > 0) {
    embed.fields.push({
      name: 'Discord API warnings',
      value: apiWarnings.join('\n'),
      inline: false,
    })
  }

  if (input.altResult.altMatchedUserIds.length > 0) {
    embed.fields.splice(10, 0, {
      name: 'Matched alt accounts',
      value: truncateField(altMatchesText),
      inline: false,
    })
  }

  const fullPayload = {
    discordId: input.profile.id,
    username: displayName,
    email: p.email,
    intel: input.intel,
    vpnOrProxy: false,
    ip: ctx.ip,
    country: resolvedCountry,
    city: input.geo?.city ?? ctx.city,
    region: input.geo?.region ?? ctx.region,
    timezone: input.geo?.timezone ?? ctx.timezone,
    continent: ctx.continent,
    fingerprint: input.fingerprint,
    canvasHash: input.canvasHash,
    userAgent: ctx.userAgent,
    accountCreatedAt: p.accountCreatedAt,
    guildMember: input.guildMember,
    guildId: input.guildId,
    altFlags: input.altResult.flags,
    altMatchedUserIds: input.altResult.altMatchedUserIds,
    socialGraphMatches: input.altResult.socialGraphMatches,
    altMatchedAccounts,
    guildEnsure: input.guildEnsure,
    roleSwapOk: input.roleSwapOk,
    roleSwapError: input.roleSwapError ?? null,
    connections: input.connections,
    guilds: input.guilds,
    connectionsFetch: input.connectionsResult.ok
      ? { ok: true, count: input.connectionsResult.data.length }
      : { ok: false, status: input.connectionsResult.status, error: input.connectionsResult.error },
    guildsFetch: input.guildsResult.ok
      ? { ok: true, count: input.guildsResult.data.length }
      : { ok: false, status: input.guildsResult.status, error: input.guildsResult.error },
    guildMemberFetch: input.guildMemberResult.ok
      ? { ok: true, hasMember: !!input.guildMember }
      : { ok: false, status: input.guildMemberResult.status, error: input.guildMemberResult.error },
    friendsNote: input.intel.relationships
      ? `relationships.read: ${input.intel.relationships.friends} friends, ${input.intel.relationships.blocked} blocked`
      : 'relationships.read not granted — connections scope lists linked third-party accounts only.',
  }

  const fileBody = JSON.stringify(fullPayload, null, 2)
  const fileName = `verify-${input.profile.id}-${Date.now()}.json`

  const form = new FormData()
  form.append(
    'payload_json',
    JSON.stringify({
      embeds: [embed],
    })
  )
  form.append('files[0]', new Blob([fileBody], { type: 'application/json' }), fileName)

  const res = await fetch(`https://discord.com/api/v10/channels/${config.alertsChannelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.botToken}`,
    },
    body: form,
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error('[Verify] complete log channel post failed:', res.status, err)
  }
}
