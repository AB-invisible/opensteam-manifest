import { cleanManifestZip } from './clean-manifest'
import { getManifestBuffer, persistManifest } from './storage'

/**
 * Load a manifest zip and rewrite its .lua with OpenSteam credit + stripped upstream junk.
 * Cached S3/local zips may predate the cleaner — always run on serve.
 * Heals storage asynchronously when cleaning changes the zip bytes.
 */
export async function prepareCleanManifestZip(
  appId: string,
  source?: Buffer | null,
): Promise<Buffer | null> {
  const raw = source ?? (await getManifestBuffer(appId))
  if (!raw?.length) return null
  const cleaned = await cleanManifestZip(raw)
  if (!source && Buffer.compare(cleaned, raw) !== 0) {
    void persistManifest(appId, cleaned).catch((err) => {
      console.warn(`[deliver-manifest] Failed to heal S3 zip for ${appId}:`, err?.message || err)
    })
  }
  return cleaned
}

export function manifestZipAttachmentHeaders(
  filename: string,
  buffer: Buffer,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    ...extraHeaders,
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'private, max-age=3600',
  }
}
