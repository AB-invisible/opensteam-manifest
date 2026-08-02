import { cleanManifestZip } from './clean-manifest'

export interface RyuuResult {
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
      return parsed.error || parsed.message || 'Ryuu returned an error object instead of ZIP.'
    }
  } catch {
    /* not JSON */
  }
  return null
}

/**
 * Fetch a manifest ZIP from the Ryuu API and write it to local storage.
 *
 * Endpoint: GET https://generator.ryuu.lol/secure_download?appid={appid}&auth_code={auth_code}
 * Returns a ZIP file binary.
 *
 * @param appId  Steam App ID (numeric string)
 * @returns      { success, zipBuffer, filename, error }
 */
export async function fetchManifestFromRyuu(appId: string, apiKeyOverride?: string): Promise<RyuuResult> {
  const apiKey = apiKeyOverride?.trim() || process.env.RYUU_API_KEY

  if (!apiKey) {
    return { success: false, error: 'RYUU_API_KEY is not configured on this server.' }
  }

  const appIdParam = encodeURIComponent(appId)
  const authCode = encodeURIComponent(apiKey)
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: `https://generator.ryuu.lol/secure_download?appid=${appIdParam}&auth_code=${authCode}`,
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'User-Agent': 'OpenSteam/1.0',
      },
    },
    {
      url: `https://generator.ryuu.lol/api/download/${appIdParam}?file_type=manifest`,
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'X-Auth-Key': apiKey,
        'User-Agent': 'OpenSteam/1.0',
      },
    },
    {
      url: `https://generator.ryuu.lol/api/download/${appIdParam}?file_type=manifest&auth_key=${authCode}`,
      headers: {
        Accept: 'application/zip, application/octet-stream, */*',
        'X-Auth-Key': apiKey,
        'User-Agent': 'OpenSteam/1.0',
      },
    },
  ]

  let lastError = 'Ryuu manifest download failed.'

  for (const attempt of attempts) {
    let response: Response
    try {
      response = await fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(45000),
      })
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string }
      lastError =
        error?.name === 'TimeoutError'
          ? 'Ryuu API timed out after 45 seconds.'
          : `Network error contacting Ryuu API: ${error?.message || 'unknown error'}`
      continue
    }

    if (!response.ok) {
      lastError =
        response.status === 404
          ? 'Manifest not found on Ryuu.'
          : `Ryuu API returned status ${response.status}`
      continue
    }

    const arrayBuffer = await response.arrayBuffer()
    const zipBuffer = Buffer.from(arrayBuffer)
    const zipError = parseZipError(zipBuffer)
    if (zipError) {
      lastError = zipError
      continue
    }
    if (!looksLikeZip(zipBuffer)) {
      lastError = 'Ryuu response was not a valid manifest ZIP.'
      continue
    }

    const disposition = response.headers.get('content-disposition') || ''
    const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/)
    const filename = filenameMatch?.[1] || `${appId}.zip`
    const cleanedBuffer = await cleanManifestZip(zipBuffer)

    return { success: true, zipBuffer: cleanedBuffer, filename }
  }

  return { success: false, error: lastError }
}
