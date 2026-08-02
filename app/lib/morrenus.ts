import { cleanManifestZip } from './clean-manifest'

const MORRENUS_BASE = 'https://hubcapmanifest.com/api/v1'

export interface MorrenusResult {
  success: boolean
  zipBuffer?: Buffer
  /** Name of the game (parsed from content-disposition header if available) */
  filename?: string
  error?: string
  statusCode?: number
}

function looksLikeZip(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 1000) return false
  const head = buffer.slice(0, 4).toString('utf8')
  if (head.startsWith('PK')) return true
  const preview = buffer.slice(0, 200).toString('utf8').toLowerCase()
  return !preview.includes('<html') && !preview.includes('"error"') && !preview.includes('"message"')
}

function parseZipError(buffer: Buffer): string | null {
  if (buffer.length >= 1000) return null
  try {
    const text = buffer.toString('utf-8')
    if (text.includes('"error"') || text.includes('"message"')) {
      const parsed = JSON.parse(text) as { error?: string; message?: string }
      return parsed.error || parsed.message || 'Morrenus returned an error object instead of ZIP.'
    }
  } catch {
    /* not JSON */
  }
  return null
}

/**
 * Fetch a manifest ZIP from the Morrenus API and write it to local storage.
 *
 * Endpoint: GET /api/v1/manifest/{app_id}?api_key=KEY
 * Returns a ZIP file binary.
 *
 * @param appId  Steam App ID (numeric string)
 * @returns      { success, zipBuffer, filename, error }
 */
export async function fetchManifestFromMorrenus(appId: string, apiKeyOverride?: string): Promise<MorrenusResult> {
  const apiKey = apiKeyOverride?.trim() || process.env.MORRENUS_API_KEY

  if (!apiKey) {
    return { success: false, error: 'MORRENUS_API_KEY is not configured on this server.' }
  }

  const manifestPath = `${MORRENUS_BASE}/manifest/${encodeURIComponent(appId)}`
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: manifestPath,
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'X-API-Key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'OpenSteam/1.0',
      },
    },
    {
      url: `${manifestPath}?api_key=${encodeURIComponent(apiKey)}`,
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'User-Agent': 'OpenSteam/1.0',
      },
    },
  ]

  let lastError = 'Morrenus manifest download failed.'

  for (const attempt of attempts) {
    let response: Response
    try {
      response = await fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(30000),
      })
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string }
      lastError =
        error?.name === 'TimeoutError'
          ? 'Morrenus API timed out after 30 seconds.'
          : `Network error contacting Morrenus API: ${error?.message || 'unknown error'}`
      continue
    }

    if (!response.ok) {
      lastError =
        response.status === 404
          ? 'Manifest not found on Morrenus.'
          : `Morrenus API returned status ${response.status}`
      continue
    }

    const arrayBuffer = await response.arrayBuffer()
    const rawZipBuffer = Buffer.from(arrayBuffer)
    const zipError = parseZipError(rawZipBuffer)
    if (zipError) {
      lastError = zipError
      continue
    }
    if (!looksLikeZip(rawZipBuffer)) {
      lastError = 'Morrenus response was not a valid manifest ZIP.'
      continue
    }

    const zipBuffer = await cleanManifestZip(rawZipBuffer)
    const disposition = response.headers.get('content-disposition') || ''
    const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/)
    const filename = filenameMatch?.[1] || `${appId}.zip`

    return { success: true, zipBuffer, filename }
  }

  return { success: false, error: lastError }
}
