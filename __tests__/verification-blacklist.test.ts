import { describe, expect, it } from 'vitest'
import { buildBlockedMessage } from '@/app/lib/verification-blacklist'

describe('verification blacklist', () => {
  it('builds a user-facing blocked message', () => {
    const message = buildBlockedMessage([
      {
        kind: 'friend',
        discordId: '123',
        label: 'Bad Actor',
        reason: 'Associated with abuse ring',
      },
      {
        kind: 'guild',
        guildId: '999',
        guildName: 'Raid Server',
        reason: 'Compromised community',
      },
    ])

    expect(message).toContain('Bad Actor')
    expect(message).toContain('Raid Server')
    expect(message).toContain('unfriend or leave')
  })
})
