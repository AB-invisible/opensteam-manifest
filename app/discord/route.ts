import { NextResponse } from 'next/server'
import { getCommunityInviteLinks } from '@/app/lib/discord-community-links'

export const dynamic = 'force-dynamic'

export async function GET() {
  const invites = await getCommunityInviteLinks().catch(() => [])
  const invite = invites.find((url) => /^https:\/\/discord\.(gg|com\/invite)\//i.test(url))
    || 'https://discord.gg/yKyKhSNGKz'

  return NextResponse.redirect(invite, {
    status: 302,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
