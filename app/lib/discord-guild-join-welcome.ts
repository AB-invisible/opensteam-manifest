import { sendBotDM } from '@/app/lib/bot-admin'
import { prisma } from '@/app/lib/prisma'
import {
  getCommunityInviteLinks,
  getDiscordCommunityLinks,
  getVerifyChannelLink,
} from '@/app/lib/discord-community-links'

const JOIN_WELCOME_DEDUPE_MS = 15 * 60 * 1000

function joinWelcomeDedupeKey(discordId: string): string {
  return `DISCORD_JOIN_WELCOME_DM:${discordId}`
}

async function claimJoinWelcomeDm(discordId: string): Promise<boolean> {
  const key = joinWelcomeDedupeKey(discordId)
  const now = new Date()
  const staleBefore = new Date(now.getTime() - JOIN_WELCOME_DEDUPE_MS)
  const value = now.toISOString()

  try {
    const existing = await prisma.systemConfig.findUnique({
      where: { key },
      select: { updatedAt: true },
    })

    if (existing) {
      if (existing.updatedAt > staleBefore) return false

      const claimed = await prisma.systemConfig.updateMany({
        where: { key, updatedAt: { lte: staleBefore } },
        data: { value },
      })
      return claimed.count > 0
    }

    await prisma.systemConfig.create({
      data: { key, value, isSecret: false },
    })
    return true
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      return false
    }
    console.warn('[GuildJoinWelcome] Failed to claim DM de-dupe key:', error)
    return true
  }
}

function buildJoinWelcomeDescription(
  username: string,
  verifyChannelLink: string,
  inviteLink: string,
  isRejoin: boolean,
  rulesLink: string | null
): string {
  const intro = isRejoin
    ? `Hey **${username}**, welcome back to our Discord!`
    : `Hey **${username}**, glad you joined our Discord!`

  const verifyNote = isRejoin
    ? 'You left the server earlier — please **re-verify** your account to restore access:'
    : 'To access the server, please verify your account:'

  const lines = [
    intro,
    '',
    verifyNote,
    `🔐 **Verification channel:** ${verifyChannelLink}`,
    '',
  ]

  if (rulesLink) {
    lines.push('Before you chat, please read the rules:', `📜 **Rules:** ${rulesLink}`, '')
  }

  lines.push(
    `**Server invite:** ${inviteLink}`,
    '',
    'Open the verification channel and click **Verify** to get started.'
  )

  return lines.join('\n')
}

/**
 * Send a welcome DM to a new or rejoining guild member who still needs verification.
 */
export async function notifyGuildJoinWelcome(input: {
  discordId: string
  username: string
  isRejoin?: boolean
}): Promise<{ sent: boolean }> {
  const { discordId, username, isRejoin = false } = input
  const claimed = await claimJoinWelcomeDm(discordId)
  if (!claimed) {
    console.info('[GuildJoinWelcome] Skipping duplicate welcome DM', { discordId, isRejoin })
    return { sent: false }
  }

  const [verifyChannelLink, inviteLinks, communityLinks] = await Promise.all([
    getVerifyChannelLink(),
    getCommunityInviteLinks(),
    getDiscordCommunityLinks(),
  ])
  const inviteLink = inviteLinks[0] || 'https://discord.gg/4RdMhcYws'

  const sent = await sendBotDM(discordId, '', {
    title: isRejoin ? '👋 Welcome back to OpenSteam' : '👋 Welcome to OpenSteam',
    description: buildJoinWelcomeDescription(
      username,
      verifyChannelLink,
      inviteLink,
      isRejoin,
      communityLinks.rules
    ),
    color: 0x6366f1,
    footer: { text: 'OpenSteam · Server Welcome' },
    timestamp: new Date().toISOString(),
  })

  if (!sent) {
    console.warn('[GuildJoinWelcome] DM not delivered', { discordId, isRejoin })
  }

  return { sent }
}
