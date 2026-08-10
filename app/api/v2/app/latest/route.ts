import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const LATEST = {
  version: '1.5.7',
  tag: 'v1.5.7',
  downloadUrl:
    'https://github.com/AB-invisible/opensteam-app/releases/download/v1.5.7/OpenSteamApp.exe',
  releaseUrl: 'https://github.com/AB-invisible/opensteam-app/releases/tag/v1.5.7',
}

/** Latest OpenSteam Desktop App release metadata (fallback when GitHub API is rate-limited). */
export async function GET() {
  return NextResponse.json(LATEST, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
