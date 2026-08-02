export type SteamAppValidationResult =
  | { ok: true; appId: string; name: string; type: string }
  | { ok: false; status: 400 | 404 | 422 | 502; error: string }

type SteamAppDetailsPayload = {
  [appId: string]: {
    success: boolean
    data?: {
      name?: string
      type?: string
      fullgame?: { appid?: number; name?: string }
    }
  }
}

/**
 * Validates that an AppID exists on Steam and is a base game.
 */
export async function validateSteamBaseGameAppId(appId: string): Promise<SteamAppValidationResult> {
  if (!/^\d+$/.test(appId) || Number(appId) <= 0) {
    return { ok: false, status: 400, error: 'Numeric App ID required.' }
  }

  let payload: SteamAppDetailsPayload
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`,
      { cache: 'no-store', signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) {
      return { ok: false, status: 502, error: 'Failed to validate Steam AppID.' }
    }
    payload = (await res.json()) as SteamAppDetailsPayload
  } catch {
    return { ok: false, status: 502, error: 'Failed to validate Steam AppID.' }
  }

  const app = payload?.[appId]
  if (!app?.success || !app.data) {
    return { ok: false, status: 404, error: 'Steam AppID not found.' }
  }

  const appType = String(app.data.type || '').toLowerCase()
  if (appType === 'dlc' || app.data.fullgame?.appid) {
    return { ok: false, status: 422, error: 'DLC AppIDs are not allowed for game requests.' }
  }
  if (appType !== 'game') {
    return { ok: false, status: 422, error: 'Only base Steam games are allowed.' }
  }

  return {
    ok: true,
    appId,
    name: app.data.name || `App ${appId}`,
    type: appType,
  }
}
