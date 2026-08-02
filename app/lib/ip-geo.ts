import { isPublicIp, normalizeIp } from '@/app/lib/ip'

type IpGeo = {
  country: string
  city: string | null
  region: string | null
  timezone: string | null
}

const geoCache = new Map<string, { geo: IpGeo; expires: number }>()

/** Fallback geolocation when CDN headers are missing (e.g. Railway without cf-ipcountry). */
export async function resolveIpGeo(ip: string): Promise<IpGeo | null> {
  const normalized = normalizeIp(ip)
  if (!isPublicIp(normalized)) return null

  const now = Date.now()
  const cached = geoCache.get(normalized)
  if (cached && cached.expires > now) return cached.geo

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(normalized)}?fields=status,country,countryCode,regionName,city,timezone,message`,
      { signal: controller.signal, cache: 'no-store' }
    ).catch(() => null)
    clearTimeout(timeout)

    if (!res?.ok) return null

    const data = (await res.json()) as {
      status?: string
      country?: string
      countryCode?: string
      regionName?: string
      city?: string
      timezone?: string
    }

    if (data.status !== 'success') return null

    const geo: IpGeo = {
      country: data.countryCode || data.country || 'XX',
      city: data.city || null,
      region: data.regionName || null,
      timezone: data.timezone || null,
    }

    geoCache.set(normalized, { geo, expires: now + 60 * 60 * 1000 })
    return geo
  } catch {
    return null
  }
}
