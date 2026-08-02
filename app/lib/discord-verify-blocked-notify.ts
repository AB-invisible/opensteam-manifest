import { sendBotDM } from '@/app/lib/bot-admin'
import type { VerificationBlacklistHit } from '@/app/lib/verification-blacklist'

function buildBlockedDescription(hits: VerificationBlacklistHit[]): string {
  const lines = hits.map((hit) => {
    if (hit.kind === 'friend') {
      return `👤 **${hit.label}** (\`${hit.discordId}\`)\n└ ${hit.reason}`
    }
    return `🏠 **${hit.guildName}** (\`${hit.guildId}\`)\n└ ${hit.reason}`
  })

  return [
    'Your verification could not be completed because of restricted Discord connections.',
    '',
    ...lines,
    '',
    'Remove the friend(s) or leave the server(s) above, then press **Verify** in Discord again.',
  ].join('\n')
}

export async function notifyVerificationBlocked(input: {
  discordId: string
  hits: VerificationBlacklistHit[]
}): Promise<boolean> {
  if (input.hits.length === 0) return false

  return sendBotDM(input.discordId, '', {
    title: '🚫 Verification Blocked',
    description: buildBlockedDescription(input.hits),
    color: 0xef4444,
    footer: { text: 'OpenSteam Verification' },
    timestamp: new Date().toISOString(),
  })
}
