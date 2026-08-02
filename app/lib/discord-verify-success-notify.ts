import { sendBotDM } from '@/app/lib/bot-admin'
import { getDiscordCommunityLinks } from '@/app/lib/discord-community-links'
import { sendBrandedEmail } from '@/app/lib/email'

function buildDmDescription(
  username: string,
  links: Awaited<ReturnType<typeof getDiscordCommunityLinks>>
): string {
  const lines = [
    `Welcome **${username}** — your Discord account is now verified on OpenSteam.`,
    '',
    'Before you get started, please:',
    '',
  ]

  if (links.rules) {
    lines.push(`📜 **Read the rules:** ${links.rules}`)
  }
  if (links.announcements) {
    lines.push(`📢 **Check announcements:** ${links.announcements}`)
  }
  lines.push(`🌐 **Visit our website:** ${links.website}`)

  return lines.join('\n')
}

function buildEmailBody(
  username: string,
  links: Awaited<ReturnType<typeof getDiscordCommunityLinks>>
): string {
  const parts = [
    `Hello <strong>${username}</strong>,`,
    '<br><br>Your Discord account has been successfully verified on OpenSteam. You now have full access to the server and platform.',
    '<br><br>Please take a moment to review these important links:',
  ]

  if (links.rules) {
    parts.push(
      `<br><br>📜 <strong>Server rules:</strong> <a href="${links.rules}">${links.rules}</a>`
    )
  }
  if (links.announcements) {
    parts.push(
      `<br>📢 <strong>Announcements:</strong> <a href="${links.announcements}">${links.announcements}</a>`
    )
  }
  parts.push(
    `<br>🌐 <strong>Main site:</strong> <a href="${links.website}">${links.website}</a>`,
    '<br><br>Welcome to the community!'
  )

  return parts.join('')
}

/**
 * Notify a user after successful Discord verification (DM + optional email).
 */
export async function notifyVerificationSuccess(input: {
  discordId: string
  username: string
  email?: string | null
}): Promise<{ dm: boolean; email: boolean }> {
  const { discordId, username, email } = input
  const links = await getDiscordCommunityLinks()
  const result = { dm: false, email: false }

  result.dm = await sendBotDM(discordId, '', {
    title: '✅ Verification Successful',
    description: buildDmDescription(username, links),
    color: 0x10b981,
    footer: { text: 'OpenSteam Verification' },
    timestamp: new Date().toISOString(),
  })

  if (email) {
    try {
      await sendBrandedEmail(
        email,
        'OpenSteam — Verification Successful',
        'Verification Complete',
        buildEmailBody(username, links),
        '#10b981',
        undefined,
        {
          buttonText: 'Open OpenSteam',
          buttonUrl: links.website,
        }
      )
      result.email = true
    } catch (err) {
      console.warn('[Verify] Success email failed:', err)
    }
  }

  return result
}
