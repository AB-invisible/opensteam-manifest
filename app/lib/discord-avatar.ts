import { normalizeDiscordSnowflake } from './discord-id'

const CDN = 'https://cdn.discordapp.com'
const MEDIA_CDN = 'https://media.discordapp.net'

/** Sizes Discord's avatar CDN accepts (?size= rejects others, e.g. 72 → 400). */
const ALLOWED_AVATAR_SIZES = [16, 32, 40, 48, 64, 80, 96, 100, 128, 256, 512, 1024, 2048, 4096]

function normalizeAvatarSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 128
  let best = ALLOWED_AVATAR_SIZES[0]
  let bestDist = Math.abs(size - best)
  for (const candidate of ALLOWED_AVATAR_SIZES) {
    const dist = Math.abs(size - candidate)
    if (dist < bestDist || (dist === bestDist && candidate > best)) {
      best = candidate
      bestDist = dist
    }
  }
  return best
}

function stripAvatarHashExtension(hash: string): string {
  return hash.replace(/\.(webp|png|gif|jpe?g)$/i, '')
}

function avatarExtension(hash: string): 'gif' | 'png' {
  return hash.startsWith('a_') ? 'gif' : 'png'
}

/**
 * Discord animated avatars use hash prefix `a_` and must be requested as `.gif`.
 * Static avatars must use `.png` — `.webp` and `?size=` on cdn.discordapp.com return 400.
 * Sized requests should go through media.discordapp.net.
 */
export function buildDiscordAvatarUrl(
  discordId: string,
  avatarHash: string,
  size = 128
): string {
  const hash = stripAvatarHashExtension(avatarHash.trim())
  const ext = avatarExtension(hash)
  const normalizedSize = normalizeAvatarSize(size)
  if (Number.isFinite(size) && size > 0) {
    return `${MEDIA_CDN}/avatars/${discordId}/${hash}.${ext}?size=${normalizedSize}`
  }
  return `${CDN}/avatars/${discordId}/${hash}.${ext}`
}

/**
 * Discord animated avatars use hash prefix `a_` and must be requested as `.gif`.
 * OAuth often emits `.png`; those URLs fail to load for animated avatars.
 */
export function normalizeDiscordAvatarHttpUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname !== 'cdn.discordapp.com' && u.hostname !== 'media.discordapp.net') return url
    const seg = u.pathname.split('/').filter(Boolean)
    if (seg[0] !== 'avatars' || seg.length < 3) return url
    const file = seg[2]
    const hash = stripAvatarHashExtension(file)
    if (!hash.startsWith('a_') || !/\.png$/i.test(file)) return url
    seg[2] = `${hash}.gif`
    u.pathname = '/' + seg.join('/')
    u.search = ''
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Resolves a usable avatar URL: supports full URL (OAuth), CDN hash, or default embed avatar.
 */
export function getDiscordCdnAvatarUrl(
  discordId: string | null | undefined,
  avatar: string | null | undefined,
  size = 64
): string | null {
  const id = discordId ? normalizeDiscordSnowflake(discordId) || String(discordId).trim() : ''
  let a = typeof avatar === 'string' ? avatar.trim() : ''

  if (a.startsWith('http://') || a.startsWith('https://')) {
    const match = a.match(/\/avatars\/(\d+)\/([a-zA-Z0-9_]+)/)
    if (match) {
      return buildDiscordAvatarUrl(match[1], match[2], size)
    }
    return normalizeDiscordAvatarHttpUrl(a)
  }

  if (id && a) {
    return buildDiscordAvatarUrl(id, a, size)
  }

  if (id) {
    try {
      const snow = BigInt(id)
      const idx = Number((snow / BigInt(4194304)) % BigInt(6))
      return `${CDN}/embed/avatars/${Math.abs(idx)}.png`
    } catch {
      const snow = Number(id)
      const idx = Number.isFinite(snow) && snow > 0 ? Math.abs(Math.floor(snow / Math.pow(2, 22)) % 6) : 0
      return `${CDN}/embed/avatars/${idx}.png`
    }
  }

  return null
}

/** Client-side fallbacks when a Discord CDN avatar URL fails to load (no API call). */
export function getDiscordAvatarErrorFallbacks(
  discordId: string | null | undefined,
  failedSrc: string,
  size = 64
): string[] {
  const options: string[] = []
  const seen = new Set<string>()

  const push = (url: string | null | undefined) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    options.push(url)
  }

  const id = discordId ? normalizeDiscordSnowflake(discordId) || String(discordId).trim() : ''
  const match = failedSrc.match(/\/avatars\/(\d+)\/([a-zA-Z0-9_]+)/)

  if (id && match) {
    const hash = stripAvatarHashExtension(match[2])
    const ext = avatarExtension(hash)
    push(`${CDN}/avatars/${id}/${hash}.${ext}`)
    push(`${CDN}/avatars/${id}/${hash}`)
    if (ext === 'png') {
      push(`${MEDIA_CDN}/avatars/${id}/${hash}.gif?size=${size}`)
    } else {
      push(`${MEDIA_CDN}/avatars/${id}/${hash}.png?size=${size}`)
    }
  }

  return options
}
