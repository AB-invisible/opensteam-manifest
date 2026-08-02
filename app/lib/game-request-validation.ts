import { prisma } from '@/app/lib/prisma'

export type ExistingGameInDb = { steamAppId: string; name: string }

export async function findGameAlreadyInDatabase(
  appId: string | null | undefined,
  name?: string | null
): Promise<ExistingGameInDb | null> {
  const normalizedAppId = appId ? String(appId).trim() : ''
  if (normalizedAppId) {
    const byAppId = await prisma.manifest.findUnique({
      where: { steamAppId: normalizedAppId },
      select: { steamAppId: true, name: true },
    })
    if (byAppId) return byAppId
  }

  const normalizedName = name ? String(name).trim() : ''
  if (normalizedName) {
    const byName = await prisma.manifest.findFirst({
      where: { name: { equals: normalizedName, mode: 'insensitive' } },
      select: { steamAppId: true, name: true },
    })
    if (byName) return byName
  }

  return null
}

export function gameAlreadyInDatabaseMessage(game: ExistingGameInDb): string {
  return `This game is already available in our library (${game.name}, App ID ${game.steamAppId}).`
}
