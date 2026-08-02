import { prisma } from '@/app/lib/prisma'
import { persistManifest } from '@/app/lib/storage'
import { cleanManifestZip } from '@/app/lib/clean-manifest'
import { sendWebhook } from '@/app/lib/webhooks'
import { updateDiscordGameRequest } from '@/app/lib/discord-requests'
import { sendTelegramGameAnnouncement } from '@/app/lib/telegram-bot'

export type IngestManifestResult = {
  manifest: { id: string; steamAppId: string; name: string; fileSize: bigint | null }
  resolvedName: string
  wasUpdate: boolean
  storageType: string
  fulfilledRequestCount: number
}

/**
 * Persist a manifest ZIP and upsert DB metadata (shared by upload route + staff probe import).
 */
export async function ingestManifestZip(params: {
  appId: string
  zipBuffer: Buffer
  userId: string
  name?: string | null
}): Promise<IngestManifestResult> {
  const appIdStr = String(params.appId).trim()
  const buffer = await cleanManifestZip(params.zipBuffer)
  const { storageType } = await persistManifest(appIdStr, buffer)

  const existingManifest = await prisma.manifest.findUnique({
    where: { steamAppId: appIdStr },
  })

  const incomingName = params.name?.trim() || ''
  const isPlaceholder = /^(Manifest|App)\s+\d+$/i.test(incomingName)
  let resolvedName = isPlaceholder ? '' : incomingName
  let resolvedImageUrl: string | undefined

  const STEAM_RETRY_DELAYS_MS = [0, 800, 2200]
  for (let attempt = 0; attempt < STEAM_RETRY_DELAYS_MS.length; attempt++) {
    if (STEAM_RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, STEAM_RETRY_DELAYS_MS[attempt]))
    }
    try {
      const steamRes = await fetch(
        `https://store.steampowered.com/api/appdetails?appids=${appIdStr}&l=english&cc=us`,
        { signal: AbortSignal.timeout(8000) },
      )
      if (steamRes.status === 429) continue
      if (!steamRes.ok) break
      const steamJson = (await steamRes.json()) as Record<
        string,
        { success?: boolean; data?: { name?: string; header_image?: string } }
      >
      const node = steamJson?.[appIdStr]
      if (!node?.success || !node.data) break
      if (!resolvedName && node.data.name) resolvedName = String(node.data.name).slice(0, 200)
      if (node.data.header_image) resolvedImageUrl = String(node.data.header_image)
      break
    } catch {
      /* retry */
    }
  }
  if (!resolvedName) {
    resolvedName = `Manifest ${appIdStr}`
  }

  const existingIsPlaceholder = /^(Manifest|App)\s+\d+$/i.test(existingManifest?.name || '')
  const manifest = await prisma.manifest.upsert({
    where: { steamAppId: appIdStr },
    update: {
      name:
        !isPlaceholder && incomingName
          ? incomingName
          : existingIsPlaceholder
            ? resolvedName
            : undefined,
      fileSize: BigInt(buffer.length),
      updatedAt: new Date(),
    },
    create: {
      steamAppId: appIdStr,
      name: resolvedName,
      fileSize: BigInt(buffer.length),
      userId: params.userId,
    },
  })

  const pendingRequests = await prisma.gameRequest.findMany({
    where: { appId: appIdStr, status: 'PENDING' },
    include: { user: { select: { discordId: true } } },
  })

  const requesterDiscordIds = Array.from(
    new Set(pendingRequests.map((r) => r.user.discordId).filter(Boolean)),
  ) as string[]

  if (pendingRequests.length > 0) {
    await prisma.gameRequest.updateMany({
      where: { id: { in: pendingRequests.map((r) => r.id) } },
      data: { status: 'FULFILLED' },
    })
    for (const req of pendingRequests) {
      void updateDiscordGameRequest(req.id)
    }
  }

  void sendWebhook(existingManifest ? 'GAME_UPDATED' : 'GAME_ADDED', {
    gameName: manifest.name,
    appId: manifest.steamAppId,
    userId: params.userId,
    username:
      (
        await prisma.user.findUnique({
          where: { id: params.userId },
          select: { username: true },
        })
      )?.username ?? 'staff',
    imageUrl: resolvedImageUrl,
    requesterDiscordIds,
  })

  void sendTelegramGameAnnouncement({
    gameName: manifest.name,
    appId: manifest.steamAppId,
    imageUrl: resolvedImageUrl,
    wasUpdate: Boolean(existingManifest),
  })

  return {
    manifest,
    resolvedName: manifest.name,
    wasUpdate: Boolean(existingManifest),
    storageType,
    fulfilledRequestCount: pendingRequests.length,
  }
}
