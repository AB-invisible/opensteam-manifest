/** Discord API helpers used during verification complete step. OAuth uses NextAuth (/api/auth/callback/discord). */

export type DiscordFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; data: T; status: number; error: string }

export async function fetchDiscordUserProfile(accessToken: string) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(`Failed to fetch Discord profile (${res.status}): ${err.slice(0, 120)}`)
  }
  return res.json() as Promise<import('./discord-verify-intel').DiscordUserProfile>
}

async function fetchDiscordJson<T>(url: string, accessToken: string, label: string): Promise<DiscordFetchResult<T>> {
  const empty = [] as unknown as T
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const error = await res.text().catch(() => res.statusText)
      // Standard web OAuth tokens cannot access relationships (requires Discord Activity / Embedded App SDK),
      // so 401 Unauthorized is expected for web verification. Suppress warning log noise for 401 relationships.
      if (!(res.status === 401 && label === 'relationships')) {
        console.warn(`[Discord OAuth] ${label} fetch failed:`, res.status, error.slice(0, 200))
      }
      return { ok: false, data: empty, status: res.status, error }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[Discord OAuth] ${label} fetch error:`, message)
    return { ok: false, data: empty, status: 0, error: message }
  }
}

export async function fetchDiscordConnections(accessToken: string) {
  return fetchDiscordJson<unknown[]>(
    'https://discord.com/api/users/@me/connections',
    accessToken,
    'connections'
  )
}

export async function fetchDiscordGuilds(accessToken: string) {
  return fetchDiscordJson<unknown[]>(
    'https://discord.com/api/users/@me/guilds',
    accessToken,
    'guilds'
  )
}

export type DiscordRelationship = {
  id?: string
  type?: number
  nickname?: string | null
  user?: { id?: string; username?: string; global_name?: string | null }
}

export async function fetchDiscordRelationships(accessToken: string) {
  return fetchDiscordJson<DiscordRelationship[]>(
    'https://discord.com/api/users/@me/relationships',
    accessToken,
    'relationships'
  )
}
