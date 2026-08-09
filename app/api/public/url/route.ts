import { NextResponse } from 'next/server'
import { getShareablePublicUrl, readPublicTunnelUrl, resolvePublicAppUrl } from '@/app/lib/public-app-url'

export const dynamic = 'force-dynamic'

export async function GET() {
  const publicUrl = readPublicTunnelUrl() || resolvePublicAppUrl()
  const apiBaseUrl = publicUrl.replace(/\/$/, '')
  return NextResponse.json(
    {
      publicUrl: apiBaseUrl,
      apiBaseUrl,
      shareUrl: getShareablePublicUrl(),
      localUrl: 'https://opensteam.lol',
      note: publicUrl
        ? 'Use apiBaseUrl for OpenSteam Desktop App pairing and API calls.'
        : 'Tunnel not running. Start manifest-tunnel to get a public link.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}