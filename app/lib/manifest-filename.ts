/**
 * True when a manifest name is one of the legacy placeholders
 * ("Manifest 730" / "App 730") rather than a real game name.
 */
export function isPlaceholderManifestName(name: string | null | undefined): boolean {
  return !name || /^(Manifest|App)\s+\d+$/i.test(name)
}

/**
 * Build a safe ZIP filename for a manifest download.
 * - Sanitises to filename-safe characters, caps to 64 chars.
 * - Prevents the legacy "App_<appId>_<appId>.zip" / "Manifest_<appId>_<appId>.zip"
 *   doubling when the stored manifest name is itself a placeholder.
 * - Falls back to `App_<appId>.zip` when no usable name is available.
 */
export function safeManifestFilename(name: string | null | undefined, appId: string | number): string {
  const appIdStr = String(appId)
  const cleaned = (name || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64)

  if (!cleaned) return `App_${appIdStr}.zip`
  if (cleaned === `App_${appIdStr}` || cleaned === `Manifest_${appIdStr}`) {
    return `App_${appIdStr}.zip`
  }
  if (cleaned.endsWith(`_${appIdStr}`)) {
    return `${cleaned}.zip`
  }
  return `${cleaned}_${appIdStr}.zip`
}

/**
 * Fetch the real game name from Steam's appdetails API.
 * Retries with backoff because Steam rate-limits aggressively.
 * Returns null if the app isn't on Steam or Steam is unreachable.
 */
export async function fetchSteamGameName(appId: string | number): Promise<string | null> {
  const meta = await fetchSteamStoreMeta(appId)
  return meta?.gameName || null
}

export async function fetchSteamStoreMeta(
  appId: string | number,
): Promise<{ gameName: string | null; imageUrl: string | null; shortDescription: string | null } | null> {
  const appIdStr = String(appId)
  const RETRY_DELAYS_MS = [0, 800, 2200, 5000]
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    }
    try {
      const res = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appIdStr}&l=english&cc=us&filters=basic`,
        {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: 'application/json', 'User-Agent': 'OpenSteam/1.0' },
        },
      )
      if (res.status === 429) continue
      if (!res.ok) break
      const json: any = await res.json()
      const node = json?.[appIdStr]
      if (!node || node.success === false) break
      if (node.data) {
        return {
          gameName: node.data.name ? String(node.data.name).slice(0, 200) : null,
          imageUrl: node.data.header_image || null,
          shortDescription: node.data.short_description
            ? String(node.data.short_description).slice(0, 500)
            : null,
        }
      }
      break
    } catch {
      // retry
    }
  }
  return null
}
