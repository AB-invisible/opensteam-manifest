import { describe, it, expect } from 'vitest'
import { getHostedBotAllowedCommands } from '@/app/lib/hosted-bot-plans'

describe('getHostedBotAllowedCommands', () => {
  it('includes drop for reseller plans', () => {
    expect(getHostedBotAllowedCommands('RESELLER')).toContain('drop')
  })

  it('excludes drop for branded premium plans', () => {
    expect(getHostedBotAllowedCommands('PREMIUM')).not.toContain('drop')
    expect(getHostedBotAllowedCommands('PREMIUM')).toContain('gen')
  })

  it('returns base commands for free plan', () => {
    expect(getHostedBotAllowedCommands('FREE')).toEqual(['gen', 'help'])
  })
})
