import { normalizeDiscordSnowflake } from './discord-id'
import { sendBotDmWithFailover, resolveGuildBotToken } from '@/app/lib/discord-bot-credentials'
import { prisma } from './prisma'
import { getStorageUsage } from './storage'
import { SYSTEM_NAMES } from './config'
import { TRIAL_MOD_DAYS } from './moderator-trial'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Discord Bot Administrative Utilities
 */

export interface DiscordInteractionResponse {
  type: number
  data?: {
    content?: string
    embeds?: any[]
  }
}

/**
 * Handles /admin stats
 */
export async function getSystemStatsEmbed() {
  const [userCount, manifestCount, keyCount, totalRequests] = await Promise.all([
    prisma.user.count(),
    prisma.manifest.count(),
    prisma.apiKey.count(),
    prisma.apiUsage.count()
  ])

  const storage = await getStorageUsage()
  const storageGB = (storage.totalBytes / (1024 * 1024 * 1024)).toFixed(2)

  return {
    title: `📊 ${SYSTEM_NAMES.BOT_NAME} Stats`,
    color: 0x6366f1, // Indigo
    fields: [
      { name: 'Accounts', value: `${userCount}`, inline: true },
      { name: 'Manifests', value: `${manifestCount}`, inline: true },
      { name: 'API Keys', value: `${keyCount}`, inline: true },
      { name: 'Total Requests', value: `${totalRequests.toLocaleString()}`, inline: true },
      { name: 'Storage Used', value: `${storageGB} GB / 5 GB`, inline: true },
      { name: 'Status', value: '🟢 Operational', inline: true }
    ],
    timestamp: new Date().toISOString(),
    footer: { text: SYSTEM_NAMES.BOT_NAME }
  }
}

/**
 * Handles /admin ban [userId] [reason]
 */
export async function banUserViaBot(userId: string, reason: string) {
  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { discordId: userId }] }
    })

    if (!user) return { success: false, message: 'User not found.' }

    const { banUserGlobally } = await import('@/app/lib/ratelimit')
    await banUserGlobally(user.id, `Remote Ban via Discord: ${reason}`)

    // Log the administrative action
    await prisma.sentinelLog.create({
      data: {
        userId: user.id,
        action: 'AUTO_JAIL',
        score: 100,
        reason: `Remote Ban via Discord: ${reason}`,
        details: JSON.stringify({ source: 'DiscordAdminBot', reason })
      }
    })

    return { success: true, message: `Successfully banned ${user.username} (${user.id}).` }
  } catch (error) {
    console.error('[Bot Admin Ban Error]', error)
    return { success: false, message: 'Internal error while processing ban.' }
  }
}

/**
 * Checks manifest indexing status
 */
export async function checkManifestStatus(appId: string) {
  const manifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId }
  })

  if (!manifest) return { exists: false }

  return {
    exists: true,
    name: manifest.name,
    downloads: manifest.downloads,
    createdAt: manifest.createdAt
  }
}
/**
 * Sends a real-time system or security alert to a designated Discord channel.
 * Uses the DISCORD_BOT_TOKEN and DISCORD_ALERTS_CHANNEL_ID from SystemConfig.
 */
export async function sendBotAlert(message: string, type: 'SECURITY' | 'SYSTEM' = 'SYSTEM') {
  try {
    const [guildBot, channelId] = await Promise.all([
      resolveGuildBotToken(),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_ALERTS_CHANNEL_ID' } }),
    ])

    if (!guildBot.token || !channelId?.value) return

    const color = type === 'SECURITY' ? 0xff4444 : 0x6366f1
    const title = type === 'SECURITY' ? SYSTEM_NAMES.SENTINEL_ALERT_TITLE : SYSTEM_NAMES.SYSTEM_NOTIFICATION_TITLE

    await fetch(`https://discord.com/api/v10/channels/${channelId.value}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${guildBot.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        embeds: [{
          title,
          description: message,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: SYSTEM_NAMES.AUTONOMY_ENGINE_NAME }
        }]
      })
    })
  } catch (error) {
    console.error('[Bot Alert Error]', error)
  }
}

/**
 * Sends a DM to a user via the bot. Returns true if Discord accepted the message.
 * Uses one active DM source; auto mode switches to backup only after quarantine.
 */
export async function sendBotDM(
  discordId: string,
  message: string,
  embed?: any,
  options?: { skipAntiPhishing?: boolean; userId?: string }
): Promise<boolean> {
  try {
    const result = await sendBotDmWithFailover(discordId, message, embed, options)
    if (!result.sent) {
      console.warn('[Bot DM] Send failed', { discordId, error: result.error, quarantine: result.quarantineDetected })
    }
    return result.sent
  } catch (error) {
    console.error('[Bot DM Error]', error)
    return false
  }
}

const TRIAL_GUIDES_URL = 'http://127.0.0.1:3000/dashboard?tab=guides'
const TRIAL_TESTS_URL = 'http://127.0.0.1:3000/dashboard?tab=tests'

export type SendTrialWelcomeDmOptions = {
  /** If set, `trialWelcomeDmDeliveredAt` is updated on successful send */
  userId?: string
}

/**
 * Welcome DM when a user is assigned Trial Moderator (dashboard Guides + Tests links).
 * @returns true if the DM was sent successfully
 */
export async function sendTrialModeratorWelcomeDm(
  discordId: string,
  username: string,
  options?: SendTrialWelcomeDmOptions
): Promise<boolean> {
  const id = normalizeDiscordSnowflake(discordId) || String(discordId).trim()
  if (!id) {
    console.warn('[TrialModeratorWelcomeDM] Missing Discord id')
    return false
  }

  const embed = {
    title: 'Welcome to the Moderation Team',
    description: [
      `Hey **${username}**,`,
      '',
      `You have been assigned **Trial Moderator** on OpenSteam. **Your trial runs for ${TRIAL_MOD_DAYS} days** — use that time to learn the handbook, workflows, and expectations.`,
      '',
      'Visit **[opensteam.lol](http://127.0.0.1:3000)** → sign in → **dashboard** → sidebar **Guides** (Moderator Handbook).',
      '',
      `**When staff releases your assessment**, you will get a **Discord DM** with a link — complete it from there. The **Tests** tab may also show a legacy handbook evaluation when applicable.`,
      '',
      '**Save this DM** — quick copy links:',
      `${TRIAL_GUIDES_URL}`,
      `${TRIAL_TESTS_URL}`,
    ].join('\n'),
    color: 0x6366f1,
    fields: [
      {
        name: 'Guides (handbook)',
        value: `[Open Guides](${TRIAL_GUIDES_URL})`,
        inline: true,
      },
      {
        name: 'Tests (after trial)',
        value: `[Open Tests](${TRIAL_TESTS_URL})`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'OpenSteam · Moderation — bookmark this message' },
  }

  const ok = await sendBotDM(
    id,
    `<@${id}>\n\nYou have been assigned **Trial Moderator**. Read the welcome message below.`,
    embed
  )
  if (ok && options?.userId) {
    await prisma.user.update({
      where: { id: options.userId },
      data: { trialWelcomeDmDeliveredAt: new Date() },
    })
  }
  return ok
}

// ── /drop command ─────────────────────────────────────────────────────────────

/**
 * Executes a manifest drop: selects `count` random manifests that are not on
 * 7-day cooldown, posts an embed to DISCORD_DROP_CHANNEL_ID, and records each
 * with an expiresAt 7 days from now. Administrator-only via Discord permissions.
 */
export async function executeAccountDrop(
  count: number,
  triggeredByDiscordId: string,
  minGames?: number,
  platform?: string
): Promise<{ success: boolean; message: string; dropped: number }> {
  // @ts-ignore - Importing JS into TS
  const { executeAccountDrop: sharedDrop } = require('../../scripts/lib/drop-logic.js')
  return sharedDrop(count, triggeredByDiscordId, prisma, minGames, platform)
}

/**
 * Daily cleanup: removes expired ManifestDrop records (expiresAt < now).
 * Call from /api/admin/maintenance/run or a scheduled cron.
 */
export async function cleanupExpiredDrops(): Promise<number> {
  const result = await (prisma as any).manifestDrop.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count ?? 0
}

/**
 * Creates a new key donation
 */
export async function createDonation(discordId: string, gameName: string, steamKey: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId }
    })

    if (!user) {
      return { success: false, message: 'User not found in database. Please login to the dashboard first.' }
    }

    const donation = await prisma.keyDonation.create({
      data: {
        userId: user.id,
        gameName,
        steamKey,
        status: 'PENDING'
      }
    })

    // Notify staff channel
    const staffChannelId = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_STAFF_CHANNEL_ID' } })
    if (staffChannelId?.value) {
      const token = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
      if (token?.value) {
        await fetch(`https://discord.com/api/v10/channels/${staffChannelId.value}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${token.value}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            embeds: [{
              title: '🎁 New Key Donation',
              color: 0xf59e0b, // Amber
              fields: [
                { name: 'User', value: `<@${discordId}>`, inline: true },
                { name: 'Game', value: gameName, inline: true },
                { name: 'Key', value: `\`${steamKey}\``, inline: false },
                { name: 'Donation ID', value: donation.id, inline: false }
              ],
              footer: { text: 'Use /admin donation approve [id] or reject [id]' }
            }],
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    label: 'Approve',
                    style: 3, // Success
                    custom_id: `donation_approve_${donation.id}`
                  },
                  {
                    type: 2,
                    label: 'Reject',
                    style: 4, // Danger
                    custom_id: `donation_reject_${donation.id}`
                  }
                ]
              }
            ]
          })
        })
      }
    }

    return { success: true, message: 'Thank you for your donation! Staff will review it shortly.' }
  } catch (error) {
    console.error('[Create Donation Error]', error)
    return { success: false, message: 'Internal error while processing donation.' }
  }
}

/**
 * Assigns the Discord donator role only — never changes platform staff role.
 */
export async function assignDonatorDiscordRole(discordId: string): Promise<boolean> {
  const normalizedId = normalizeDiscordSnowflake(discordId)
  if (!normalizedId) return false

  try {
    const [guildConfig, tokenConfig, roleIdConfig] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_DONATOR_ROLE_ID' } }),
    ])

    const guildId = guildConfig?.value || process.env.DISCORD_GUILD_ID
    const botToken = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN
    if (!guildId || !botToken) return false

    let roleId = roleIdConfig?.value || process.env.DISCORD_DONATOR_ROLE_ID || null

    if (!roleId) {
      const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${botToken}` },
      })
      if (!rolesRes.ok) return false
      const roles = (await rolesRes.json()) as Array<{ id: string; name: string }>
      const donatorRole = roles.find((role) => role.name.toLowerCase().includes('donator'))
      roleId = donatorRole?.id || null
    }

    if (!roleId) return false

    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${normalizedId}/roles/${roleId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bot ${botToken}` },
      }
    )

    return res.ok || res.status === 204
  } catch (error) {
    console.error('[Assign Donator Role Error]', error)
    return false
  }
}

/**
 * Approves a donation
 */
export async function approveDonation(donationId: string) {
  try {
    const donation = await prisma.keyDonation.findUnique({
      where: { id: donationId },
      include: { user: true }
    })

    if (!donation) return { success: false, message: 'Donation not found.' }
    if (donation.status !== 'PENDING') return { success: false, message: `Donation is already ${donation.status}.` }

    await prisma.keyDonation.update({
      where: { id: donationId },
      data: { status: 'APPROVED' }
    })

    if (donation.user.discordId) {
      await assignDonatorDiscordRole(donation.user.discordId)
    }

    // DM and Email User
    await sendBotDM(
      donation.user.discordId, 
      `Thanks for donating **${donation.gameName}**! Your **Donator** Discord role has been applied. This is a community perk only — it does not grant moderator access.`
    );

    if (donation.user.email) {
      const { sendBrandedEmail } = await import('./email');
      await sendBrandedEmail(
        donation.user.email,
        'Donation Approved - OpenSteam',
        'Donation Approved',
        `Thanks for donating <strong>${donation.gameName}</strong>! Your contribution has been approved and your Donator Discord role has been applied.<br><br><strong>Note:</strong> Donator status is a community thank-you perk only. It does not grant moderator or staff platform access.`,
        '#10b981',
        undefined,
        { userId: donation.user.id, badge: 'Donation Approved' }
      ).catch(() => {});
    }

    return { success: true, message: `Donation ${donationId} approved.` }
  } catch (error) {
    console.error('[Approve Donation Error]', error)
    return { success: false, message: 'Internal error.' }
  }
}

/**
 * Rejects a donation
 */
export async function rejectDonation(donationId: string) {
  try {
    const donation = await prisma.keyDonation.findUnique({
      where: { id: donationId },
      include: { user: true }
    })

    if (!donation) return { success: false, message: 'Donation not found.' }
    if (donation.status !== 'PENDING') return { success: false, message: `Donation is already ${donation.status}.` }

    await prisma.keyDonation.update({
      where: { id: donationId },
      data: { status: 'REJECTED' }
    })

    // DM and Email User
    await sendBotDM(
      donation.user.discordId, 
      `Your donation for **${donation.gameName}** was rejected. Donating non-Steam keys or random strings may result in a ban.`
    );

    if (donation.user.email) {
      const { sendBrandedEmail } = await import('./email');
      await sendBrandedEmail(
        donation.user.email,
        'Donation Rejected - OpenSteam',
        '❌ Donation Rejected',
        `Your donation for <strong>${donation.gameName}</strong> was rejected. Please ensure you are donating valid Steam keys. Repeated fake donations may result in a ban.`,
        '#ef4444'
      ).catch(() => {});
    }

    return { success: true, message: `Donation ${donationId} rejected.` }
  } catch (error) {
    console.error('[Reject Donation Error]', error)
    return { success: false, message: 'Internal error.' }
  }
}
