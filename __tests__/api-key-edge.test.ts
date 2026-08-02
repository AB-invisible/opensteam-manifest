import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { shouldBypassVpnForApiKeyRequest } from '@/app/lib/api-key-edge'

const validKey = 'gg_' + 'a'.repeat(64)

function request(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://127.0.0.1:3000${pathname}`, { headers })
}

describe('shouldBypassVpnForApiKeyRequest', () => {
  it('bypasses VPN checks for v2 Bearer API requests', () => {
    expect(
      shouldBypassVpnForApiKeyRequest(
        request('/api/v2/generate/730', {
          Authorization: `Bearer ${validKey}`,
        })
      )
    ).toBe(true)
  })

  it('bypasses VPN checks for v2 X-API-Key requests', () => {
    expect(
      shouldBypassVpnForApiKeyRequest(
        request('/api/v2/bulk/generate', {
          'X-API-Key': validKey,
        })
      )
    ).toBe(true)
  })

  it('does not bypass VPN checks for v2 requests without an API key', () => {
    expect(shouldBypassVpnForApiKeyRequest(request('/api/v2/generate/730'))).toBe(false)
  })
})
