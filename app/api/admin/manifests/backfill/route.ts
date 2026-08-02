import { authOptions } from '@/app/lib/auth-options'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { corsHeaders } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel/Next serverless cap

/**
 * POST /api/admin/manifests/backfill
 *
 * Backfills real Steam game names for Manifest rows whose name is still the
 * legacy `Manifest <appId>` placeholder.
 *
 * Body (JSON, all optional):
 *   - dryRun: boolean  — preview without writing
 *   - limit:  number   — max rows to process this run (default 100, max 200)
 *
 * Safe to call repeatedly: already-renamed rows are filtered out automatically.
 * Throttled to ~4 req/sec to respect Steam's rate limits.
 */

const PLACEHOLDER_PATTERN = /^(Manifest|App)\s+\d+$/i
const STEAM_THROTTLE_MS = 250
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchSteamName(appId: string): Promise<{ name: string | null; status: string }> {
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english&cc=us`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return { name: null, status: `HTTP_${res.status}` }
    const json: any = await res.json()
    const node = json?.[appId]
    if (!node) return { name: null, status: 'NO_NODE' }
    if (node.success === false) return { name: null, status: 'NOT_ON_STEAM' }
    const name = node.data?.name ? String(node.data.name).slice(0, 200) : null
    if (!name) return { name: null, status: 'NO_NAME' }
    return { name, status: 'OK' }
  } catch (err: any) {
    return { name: null, status: `ERROR_${err?.message || 'unknown'}` }
  }
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
    }

    const caller = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId as string }
    })

    if (!caller || (caller.role !== 'OWNER' && caller.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: 'Forbidden. Owner or Admin access required.' },
        { status: 403, headers }
      )
    }

    const body = await request.json().catch(() => ({})) as { dryRun?: boolean; limit?: number }
    const dryRun = body.dryRun === true
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 200)

    // Fetch candidate rows. We can't filter by regex in Prisma, so pull names
    // starting with "Manifest " then narrow with the exact pattern in JS.
    const candidates = await prisma.manifest.findMany({
      where: { OR: [{ name: { startsWith: 'Manifest ' } }, { name: { startsWith: 'App ' } }] },
      select: { id: true, steamAppId: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: limit * 3 // overfetch to account for the regex narrowing
    })

    const targets = candidates
      .filter((r) => PLACEHOLDER_PATTERN.test(r.name || ''))
      .slice(0, limit)

    const totalRemainingQuery = await prisma.manifest.count({
      where: { OR: [{ name: { startsWith: 'Manifest ' } }, { name: { startsWith: 'App ' } }] }
    })

    const changes: { appId: string; from: string; to: string }[] = []
    const skipped: { appId: string; reason: string }[] = []
    let errors = 0

    for (const row of targets) {
      const { name, status } = await fetchSteamName(row.steamAppId)
      if (name) {
        changes.push({ appId: row.steamAppId, from: row.name, to: name })
        if (!dryRun) {
          try {
            await prisma.manifest.update({ where: { id: row.id }, data: { name } })
          } catch (e: any) {
            errors++
            console.error(`[Backfill] Failed to update ${row.steamAppId}:`, e?.message)
          }
        }
      } else {
        skipped.push({ appId: row.steamAppId, reason: status })
      }
      await sleep(STEAM_THROTTLE_MS)
    }

    return NextResponse.json({
      success: true,
      dryRun,
      processed: targets.length,
      updated: changes.length,
      skipped: skipped.length,
      errors,
      // Soft estimate — pattern narrowing happens client-of-DB-side
      remainingCandidates: Math.max(totalRemainingQuery - targets.length, 0),
      changes: changes.slice(0, 50), // cap response payload size
      skippedSample: skipped.slice(0, 20)
    }, { headers })

  } catch (error: any) {
    console.error('[Manifests Backfill]', error)
    return NextResponse.json(
      { error: 'Backfill failed', detail: error?.message },
      { status: 500, headers }
    )
  }
}
