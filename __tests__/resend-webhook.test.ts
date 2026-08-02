import { describe, expect, it } from 'vitest'
import { stripInboundEmailQuotes } from '@/app/lib/resend-webhook'

describe('stripInboundEmailQuotes', () => {
  it('removes quoted reply history', () => {
    const input = 'Thanks for the help.\n\nOn Wed Jul 8 2026 someone wrote:\n> old message'
    expect(stripInboundEmailQuotes(input)).toBe('Thanks for the help.')
  })

  it('removes lines starting with >', () => {
    const input = 'New reply\n> quoted line\nAnother line'
    expect(stripInboundEmailQuotes(input)).toBe('New reply\nAnother line')
  })
})
