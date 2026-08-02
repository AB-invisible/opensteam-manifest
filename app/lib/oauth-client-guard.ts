const INFLIGHT_KEY = 'gg_oauth_inflight'
const INFLIGHT_TTL_MS = 3 * 60 * 1000
const AUTOSTART_KEY = 'gg_oauth_autostarted'

function readInflightTimestamp(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(INFLIGHT_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

/** Returns false when another OAuth flow started within the last 3 minutes. */
export function tryBeginOAuth(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const existing = readInflightTimestamp()
    if (existing !== null && Date.now() - existing < INFLIGHT_TTL_MS) {
      return false
    }
    sessionStorage.setItem(INFLIGHT_KEY, String(Date.now()))
    return true
  } catch {
    return true
  }
}

export function clearOAuthInflight(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(INFLIGHT_KEY)
  } catch {
    // ignore
  }
}

/** Survives React Strict Mode remounts — only autostart once per tab session. */
export function markAutostartConsumed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(AUTOSTART_KEY) === '1') return false
    sessionStorage.setItem(AUTOSTART_KEY, '1')
    return true
  } catch {
    return true
  }
}

export function clearAutostartConsumed(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(AUTOSTART_KEY)
  } catch {
    // ignore
  }
}
