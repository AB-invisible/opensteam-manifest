import { authOptions } from '@/app/lib/auth-options'
import { corsHeaders } from '@/app/lib/auth'
import { prisma } from '@/app/lib/prisma'
import { validateSteamBaseGameAppId } from '@/app/lib/steam-app-validation'
import {
  fetchSteamAppList,
  pickRandomSteamBaseGameByProbe,
  searchSteamStoreByName,
  type SteamAppListEntry,
} from '@/app/lib/steam-app-list'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STAFF_ROLES = new Set(['OWNER', 'ADMIN', 'MODERATOR', 'SENIOR_MODERATOR'])

type ValidSteamGame = { ok: true; appId: string; name: string; type: string }

type ProbeAvailabilityFilter =
  | 'any'
  | 'ryuu'
  | 'morrenus'
  | 'both'
  | 'ryuu_only'
  | 'morrenus_only'
  | 'either'

const PROBE_AVAILABILITY_FILTERS = new Set<ProbeAvailabilityFilter>([
  'any',
  'ryuu',
  'morrenus',
  'both',
  'ryuu_only',
  'morrenus_only',
  'either',
])

function parseAvailabilityFilter(raw: string | null): ProbeAvailabilityFilter {
  if (raw && PROBE_AVAILABILITY_FILTERS.has(raw as ProbeAvailabilityFilter)) {
    return raw as ProbeAvailabilityFilter
  }
  return 'any'
}

function matchesAvailabilityFilter(
  morrenus: { available: boolean | null },
  ryuu: { available: boolean | null },
  filter: ProbeAvailabilityFilter,
): boolean {
  const morrenusAvailable = morrenus.available === true
  const ryuuAvailable = ryuu.available === true

  switch (filter) {
    case 'any':
      return true
    case 'ryuu':
      return ryuuAvailable
    case 'morrenus':
      return morrenusAvailable
    case 'both':
      return morrenusAvailable && ryuuAvailable
    case 'ryuu_only':
      return ryuuAvailable && !morrenusAvailable
    case 'morrenus_only':
      return morrenusAvailable && !ryuuAvailable
    case 'either':
      return morrenusAvailable || ryuuAvailable
    default:
      return true
  }
}

function availabilityFilterLabel(filter: ProbeAvailabilityFilter): string {
  switch (filter) {
    case 'any':
      return 'any provider availability'
    case 'ryuu':
      return 'Ryuu available'
    case 'morrenus':
      return 'Morrenus available'
    case 'both':
      return 'both Ryuu and Morrenus available'
    case 'ryuu_only':
      return 'Ryuu only (not Morrenus)'
    case 'morrenus_only':
      return 'Morrenus only (not Ryuu)'
    case 'either':
      return 'either Ryuu or Morrenus available'
    default:
      return 'any provider availability'
  }
}

async function getSteamAppList(): Promise<SteamAppListEntry[]> {
  return fetchSteamAppList()
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

async function getConfigValue(key: string): Promise<string | null> {
  const env = process.env[key]?.trim()
  if (env) return env
  const row = await prisma.systemConfig.findUnique({ where: { key } })
  return row?.value?.trim() || null
}

function takeRandomSample<T>(items: T[], count: number): T[] {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, count)
}

async function pickRandomMissingSteamGame(
  availability: ProbeAvailabilityFilter = 'any',
): Promise<ValidSteamGame | null> {
  const [manifests, pendingRequests] = await Promise.all([
    prisma.manifest.findMany({ select: { steamAppId: true } }),
    prisma.gameRequest.findMany({
      where: { appId: { not: null }, status: 'PENDING' },
      select: { appId: true },
    }),
  ])

  const present = new Set(manifests.map((m) => String(m.steamAppId)))
  const pending = new Set(pendingRequests.map((r) => String(r.appId)))
  const exclude = new Set([...present, ...pending])

  let apps: SteamAppListEntry[] = []
  try {
    apps = await getSteamAppList()
  } catch (e) {
    console.warn('[Probe] Steam catalogue fetch failed, using random AppID probe:', e)
    const probed = await pickRandomSteamBaseGameByProbe(exclude, 60)
    return probed
  }

  const candidates = apps.filter((app) => {
    const appId = String(app.appid)
    return app.name?.trim() && !exclude.has(appId)
  })

  const maxRounds = availability === 'any' ? 3 : 10
  const sampleSize = availability === 'any' ? 12 : 8

  for (let offset = 0; offset < maxRounds && candidates.length > 0; offset += 1) {
    const sample = takeRandomSample(candidates, sampleSize)
    for (const candidate of sample) {
      const validated = await validateSteamBaseGameAppId(String(candidate.appid))
      if (!validated.ok) continue

      if (availability === 'any') {
        return validated
      }

      const [morrenus, ryuu] = await Promise.all([
        checkMorrenus(validated.appId),
        checkRyuu(validated.appId),
      ])
      if (matchesAvailabilityFilter(morrenus, ryuu, availability)) {
        return validated
      }
    }
  }

  return null
}

function parseProviderAvailability(status: number, body: unknown): boolean | null {
  if (status === 404) return false
  if (status === 401 || status === 403) return null
  if (status < 200 || status >= 300) return false

  if (body && typeof body === 'object') {
    const data = body as Record<string, unknown>
    for (const key of ['available', 'exists', 'found', 'hasManifest', 'has_manifest', 'success']) {
      if (typeof data[key] === 'boolean') return data[key] as boolean
    }
    const statusText = String(data.status || data.state || '').toLowerCase()
    if (statusText.includes('found') || statusText.includes('available') || statusText.includes('ready')) return true
    if (statusText.includes('missing') || statusText.includes('not_found') || statusText.includes('not found')) return false
  }

  if (typeof body === 'string') {
    const text = body.toLowerCase()
    if (text.includes('not_found') || text.includes('not found') || text.includes('missing')) return false
    if (text.includes('available') || text.includes('found') || text.includes('ready')) return true
  }

  return true
}

async function checkMorrenus(appId: string) {
  const apiKey = await getConfigValue('MORRENUS_API_KEY')
  if (!apiKey) {
    return {
      configured: false,
      available: null,
      status: null,
      message: 'MORRENUS_API_KEY is not configured.',
    }
  }

  const url = `https://hubcapmanifest.com/api/v1/status/${encodeURIComponent(appId)}`

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'OpenSteam/1.0',
        Authorization: `Bearer ${apiKey}`,
      },
    })

    const text = await res.text().catch(() => '')
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }

    return {
      configured: Boolean(apiKey),
      available: parseProviderAvailability(res.status, body),
      status: res.status,
      message: typeof body === 'object' && body ? String((body as Record<string, unknown>).message || '') : '',
    }
  } catch (e: any) {
    return {
      configured: Boolean(apiKey),
      available: null,
      status: null,
      message: e?.name === 'TimeoutError' ? 'Morrenus status timed out.' : e?.message || 'Morrenus status check failed.',
    }
  }
}

async function checkRyuu(appId: string) {
  const apiKey = await getConfigValue('RYUU_API_KEY')
  if (!apiKey) {
    return {
      configured: false,
      available: null,
      status: null,
      message: 'RYUU_API_KEY is not configured.',
    }
  }

  const url = `https://generator.ryuu.lol/secure_download?appid=${encodeURIComponent(appId)}&auth_code=${encodeURIComponent(apiKey)}`
  const statusToAvailability = (status: number) => status >= 200 && status < 400
    ? true
    : status === 404
      ? false
      : null

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'User-Agent': 'OpenSteam/1.0',
      },
    })

    if (res.status === 405) {
      const ranged = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: 'application/zip, application/octet-stream, */*',
          Range: 'bytes=0-0',
          'User-Agent': 'OpenSteam/1.0',
        },
      })
      await ranged.body?.cancel().catch(() => {})

      return {
        configured: true,
        available: statusToAvailability(ranged.status),
        status: ranged.status,
        message: 'Ryuu checked with a one-byte range probe.',
      }
    }

    return {
      configured: true,
      available: statusToAvailability(res.status),
      status: res.status,
      message: '',
    }
  } catch (e: any) {
    return {
      configured: true,
      available: null,
      status: null,
      message: e?.name === 'TimeoutError' ? 'Ryuu HEAD check timed out.' : e?.message || 'Ryuu HEAD check failed.',
    }
  }
}

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('Origin'))

  try {
    const staff = await requireStaff()
    if (!staff.ok) {
      return NextResponse.json({ error: staff.error }, { status: staff.status, headers })
    }

    const { searchParams } = new URL(request.url)
    const random = searchParams.get('random') === '1'
    const availability = parseAvailabilityFilter(searchParams.get('availability'))
    let appId = (searchParams.get('appId') || '').trim()

    let validated
    if (random) {
      try {
        validated = await pickRandomMissingSteamGame(availability)
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || 'Failed to fetch Steam app list.' },
          { status: 502, headers }
        )
      }
      if (!validated) {
        return NextResponse.json(
          {
            error: availability === 'any'
              ? 'Could not find a random missing base game from Steam.'
              : `Could not find a random missing base game matching filter: ${availabilityFilterLabel(availability)}.`,
          },
          { status: 404, headers },
        )
      }
      appId = validated.appId
    } else {
      if (!appId) {
        return NextResponse.json({ error: 'appId is required.' }, { status: 400, headers })
      }
      validated = await validateSteamBaseGameAppId(appId)
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: validated.status, headers })
      }
    }

    const [manifest, existingRequest, morrenus, ryuu] = await Promise.all([
      prisma.manifest.findUnique({
        where: { steamAppId: validated.appId },
        select: { steamAppId: true, name: true },
      }),
      prisma.gameRequest.findFirst({
        where: { appId: validated.appId, status: 'PENDING' },
        select: { id: true, name: true, status: true },
      }),
      checkMorrenus(validated.appId),
      checkRyuu(validated.appId),
    ])

    return NextResponse.json({
      appId: validated.appId,
      name: validated.name,
      type: validated.type,
      random,
      availability: random ? availability : 'any',
      inDatabase: Boolean(manifest),
      manifest,
      pendingRequest: existingRequest,
      providers: { morrenus, ryuu },
    }, { headers })
  } catch (error: any) {
    console.error('Error probing request candidate:', error)
    return NextResponse.json({ error: error?.message || 'Failed to probe request candidate.' }, { status: 500, headers })
  }
}
