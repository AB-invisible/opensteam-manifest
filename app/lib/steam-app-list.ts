import { prisma } from '@/app/lib/prisma'
import { validateSteamBaseGameAppId } from '@/app/lib/steam-app-validation'

export type SteamAppListEntry = { appid: number; name: string }

async function resolveSteamApiKey(): Promise<string | null> {
  const env = process.env.STEAM_API_KEY?.trim()
  if (env) return env
  const row = await prisma.systemConfig.findUnique({ where: { key: 'STEAM_API_KEY' } })
  return row?.value?.trim() || null
}

type StoreAppListResponse = {
  response?: {
    apps?: Array<{ appid?: number; name?: string }>
    have_more_results?: boolean
    last_appid?: number
  }
}

/**
 * Valve retired ISteamApps/GetAppList — use IStoreService/GetAppList with a Steam Web API key.
 * Paginates until the catalogue is exhausted (or maxPages safety cap).
 */
export async function fetchSteamAppList(options?: { maxPages?: number }): Promise<SteamAppListEntry[]> {
  const key = await resolveSteamApiKey()
  if (!key) {
    throw new Error(
      'STEAM_API_KEY is not configured. Valve removed ISteamApps/GetAppList; set STEAM_API_KEY in env or Admin settings.',
    )
  }

  const apps: SteamAppListEntry[] = []
  let lastAppId = 0
  const maxPages = options?.maxPages ?? 20

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/')
    url.searchParams.set('key', key)
    url.searchParams.set('max_results', '50000')
    url.searchParams.set('include_games', 'true')
    url.searchParams.set('include_dlc', 'false')
    url.searchParams.set('include_software', 'false')
    url.searchParams.set('include_videos', 'false')
    url.searchParams.set('include_hardware', 'false')
    if (lastAppId > 0) url.searchParams.set('last_appid', String(lastAppId))

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(45_000),
      headers: { Accept: 'application/json', 'User-Agent': 'OpenSteam/1.0' },
      next: { revalidate: 86400 },
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch Steam app list (HTTP ${res.status}).`)
    }

    const data = (await res.json()) as StoreAppListResponse
    const batch = data.response?.apps ?? []
    if (batch.length === 0) break

    for (const item of batch) {
      if (typeof item.appid === 'number' && item.name?.trim()) {
        apps.push({ appid: item.appid, name: item.name.trim() })
      }
    }

    if (!data.response?.have_more_results) break
    const nextLast = data.response.last_appid
    if (typeof nextLast !== 'number' || nextLast <= lastAppId) break
    lastAppId = nextLast
  }

  if (apps.length === 0) {
    throw new Error('Steam app list response was empty.')
  }

  return apps
}

/** Store search fallback when the full catalogue is unavailable. */
export async function searchSteamStoreByName(query: string): Promise<SteamAppListEntry[]> {
  const term = query.trim()
  if (!term) return []

  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', term)
  url.searchParams.set('l', 'english')
  url.searchParams.set('cc', 'US')

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', 'User-Agent': 'OpenSteam/1.0' },
  })
  if (!res.ok) return []

  const data = (await res.json()) as { items?: Array<{ id?: number; name?: string }> }
  const items = data.items ?? []
  return items
    .filter((i) => typeof i.id === 'number' && i.name?.trim())
    .map((i) => ({ appid: i.id!, name: i.name!.trim() }))
}

/**
 * Random base-game probe when the Steam catalogue API is unavailable (no key / outage).
 * Validates random App IDs until a missing base game is found.
 */
export async function pickRandomSteamBaseGameByProbe(
  excludeAppIds: Set<string>,
  maxAttempts = 48,
): Promise<{ ok: true; appId: string; name: string; type: string } | null> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const appId = String(Math.floor(100 + Math.random() * 2_999_000))
    if (excludeAppIds.has(appId)) continue
    const validated = await validateSteamBaseGameAppId(appId)
    if (validated.ok) return validated
  }
  return null
}
