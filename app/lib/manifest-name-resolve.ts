import { prisma } from './prisma'
import { fetchSteamGameName, isPlaceholderManifestName } from './manifest-filename'

/**
 * Resolve a Steam game name and upsert the manifest registry row when missing or placeholder.
 */
export async function resolveAndUpsertManifestName(
  appId: string,
  preferredName?: string | null,
  userId?: string
): Promise<string> {
  const appIdStr = String(appId)
  let name = preferredName?.trim() || null

  if (isPlaceholderManifestName(name)) {
    name = null
  }

  if (!name) {
    name = (await fetchSteamGameName(appIdStr)) || `App ${appIdStr}`
  }

  const existing = await prisma.manifest.findUnique({ where: { steamAppId: appIdStr } })

  if (!existing) {
    if (userId) {
      await prisma.manifest
        .create({
          data: {
            steamAppId: appIdStr,
            name,
            userId,
            fileSize: BigInt(0),
            downloads: 0,
          },
        })
        .catch(() => {})
    }
  } else if (isPlaceholderManifestName(existing.name) && !isPlaceholderManifestName(name)) {
    await prisma.manifest
      .update({
        where: { steamAppId: appIdStr },
        data: { name },
      })
      .catch(() => {})
  }

  return name
}
