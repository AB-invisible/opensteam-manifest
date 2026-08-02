import { NextResponse } from 'next/server'
import { readSiteSettings } from '@/app/lib/site-settings'
import { readPublicTunnelUrl } from '@/app/lib/public-app-url'

export const dynamic = 'force-dynamic'

export async function GET() {
  const settings = readSiteSettings()
  const publicAccessUrl = settings.publicAccessUrl || readPublicTunnelUrl() || null
  return NextResponse.json(
    { ...settings, publicAccessUrl },
    {
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
