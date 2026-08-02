import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/steam/search?q=<name>
 *
 * Proxies Steam's storesearch endpoint so the home-page autocomplete can
 * resolve a game name → appId without CORS quirks. Returns a simplified
 * shape: { items: [{ id, name, image }] }.
 *
 * Includes a short in-memory cache so repeated keystrokes / common queries
 * don't all hit Steam.
 */

interface CacheEntry {
  data: { id: number; name: string; image: string | null }[]
  ts: number
}
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX_ENTRIES = 200

function cacheGet(key: string) {
  const hit = CACHE.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    CACHE.delete(key)
    return null
  }
  return hit.data
}

function cacheSet(key: string, data: CacheEntry['data']) {
  if (CACHE.size >= CACHE_MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value
    if (oldest !== undefined) CACHE.delete(oldest)
  }
  CACHE.set(key, { data, ts: Date.now() })
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  if (q.length < 2) {
    return NextResponse.json({ items: [] })
  }

  const cacheKey = q.toLowerCase()
  const cached = cacheGet(cacheKey)
  if (cached) {
    return NextResponse.json({ items: cached, cached: true })
  }

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      return NextResponse.json({ items: [], error: `Steam returned ${res.status}` }, { status: 502 })
    }
    const json: any = await res.json()
    const items = Array.isArray(json?.items) ? json.items : []

    const simplified = items
      .slice(0, 10)
      .map((it: any) => ({
        id: Number(it.id),
        name: String(it.name || ''),
        image: it.tiny_image ? String(it.tiny_image) : null
      }))
      .filter((it: any) => it.id && it.name)

    cacheSet(cacheKey, simplified)
    return NextResponse.json({ items: simplified })
  } catch (e: any) {
    return NextResponse.json({ items: [], error: e?.message || 'Search failed' }, { status: 502 })
  }
}
