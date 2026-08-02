import { NextResponse } from 'next/server'
import { getShareablePublicUrl, readPublicTunnelUrl } from '@/app/lib/public-app-url'

export const dynamic = 'force-dynamic'

export async function GET() {
  const publicUrl = readPublicTunnelUrl()
  return NextResponse.json(
    {
      publicUrl,
      shareUrl: getShareablePublicUrl(),
      localUrl: 'https://opensteam.lol',
      note: publicUrl
        ? 'Share publicUrl with other people. opensteam.lol only works on the owner PC.'
        : 'Tunnel not running. Start manifest-tunnel to get a public link.',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
