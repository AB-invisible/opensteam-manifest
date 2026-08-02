import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/app/lib/auth-options'
import { corsHeaders } from '@/app/lib/auth'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { fetchManifestFromRyuu } from '@/app/lib/ryuu'
import { fetchManifestFromMorrenus } from '@/app/lib/morrenus'
import { ingestManifestZip } from '@/app/lib/manifest-ingest'
import { validateSteamBaseGameAppId } from '@/app/lib/steam-app-validation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STAFF_ROLES = new Set(['OWNER', 'ADMIN', 'MODERATOR', 'SENIOR_MODERATOR'])

async function getConfigValue(key: string): Promise<string | null> {
  const env = process.env[key]?.trim()
  if (env) return env
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value?.trim() || null
}

async function requireStaff() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const caller = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
    select: { id: true, role: true },
  })

  if (!caller || !STAFF_ROLES.has(caller.role)) {
    return { ok: false as const, status: 403, error: 'Forbidden. Staff access required.' }
  }

  return { ok: true as const, caller }
}

/** Fetch from Ryuu or Morrenus and register via the manifest upload pipeline. */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const staff = await requireStaff()
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status, headers })
    }

    const body = await request.json().catch(() => ({}))
    const appId = typeof body.appId === 'string' ? body.appId.trim() : ''
    const source = body.source === 'ryuu' || body.source === 'morrenus' ? body.source : null
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!appId || !/^\d+$/.test(appId)) {
      return NextResponse.json({ error: 'A numeric appId is required.' }, { status: 400, headers })
    }
    if (!source) {
      return NextResponse.json({ error: 'source must be ryuu or morrenus.' }, { status: 400, headers })
    }

    const validated = await validateSteamBaseGameAppId(appId)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: validated.status, headers })
    }

    const apiKey =
      source === 'ryuu'
        ? await getConfigValue('RYUU_API_KEY')
        : await getConfigValue('MORRENUS_API_KEY')

    if (!apiKey) {
      return NextResponse.json(
        { error: `${source === 'ryuu' ? 'RYUU' : 'MORRENUS'}_API_KEY is not configured.` },
        { status: 503, headers },
      )
    }

    const fetched =
      source === 'ryuu'
        ? await fetchManifestFromRyuu(appId, apiKey)
        : await fetchManifestFromMorrenus(appId, apiKey)

    if (!fetched.success || !fetched.zipBuffer) {
      const status =
        fetched.statusCode === 404 || /not found/i.test(fetched.error || '')
          ? 404
          : 502
      return NextResponse.json(
        { error: fetched.error || `Could not download manifest from ${source}.` },
        { status, headers },
      )
    }

    const ingested = await ingestManifestZip({
      appId,
      zipBuffer: fetched.zipBuffer,
      userId: staff.caller.id,
      name: name || validated.name,
    })

    return NextResponse.json(
      {
        success: true,
        source,
        appId,
        name: ingested.resolvedName,
        wasUpdate: ingested.wasUpdate,
        storageType: ingested.storageType,
        fulfilledRequestCount: ingested.fulfilledRequestCount,
        manifest: {
          id: ingested.manifest.id,
          appId: ingested.manifest.steamAppId,
          name: ingested.manifest.name,
        },
      },
      { headers },
    )
  } catch (error: unknown) {
    console.error('[Probe Import]', error)
    const message = error instanceof Error ? error.message : 'Import failed.'
    return NextResponse.json({ error: message }, { status: 500, headers })
  }
}
