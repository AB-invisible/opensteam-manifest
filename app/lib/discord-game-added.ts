import { prisma } from './prisma'
import { fetchSteamStoreMeta, isPlaceholderManifestName } from './manifest-filename'

export const DISCORD_ADDED_GAMES_CHANNEL_KEY = 'DISCORD_ADDED_GAMES_CHANNEL_ID'

async function getAddedGamesChannelId() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: DISCORD_ADDED_GAMES_CHANNEL_KEY },
  })
  return row?.value?.trim() || process.env.DISCORD_ADDED_GAMES_CHANNEL_ID?.trim() || ''
}

async function getBotToken() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: 'DISCORD_BOT_TOKEN' },
  })
  return row?.value?.trim() || process.env.DISCORD_BOT_TOKEN?.trim() || ''
}

function truncateText(text: string, max = 280): string {
  const value = String(text || '').trim()
  if (!value) return ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function buildEmbedDescription(shortDescription?: string | null): string {
  const lead = '1 game has been added to OpenSteam.'
  const snippet = truncateText(shortDescription)
  return snippet ? `${lead}\n\n${snippet}` : lead
}

function buildGameAddedEmbedPayload({
  appId,
  gameName,
  imageUrl,
  shortDescription,
}: {
  appId: string
  gameName: string
  imageUrl?: string | null
  shortDescription?: string | null
}) {
  const appIdStr = String(appId || '').trim()
  const steamUrl = appIdStr ? `https://store.steampowered.com/app/${appIdStr}` : undefined
  const title = String(gameName || '').trim() || (appIdStr ? `App ${appIdStr}` : 'New Game')
  const headerImage = String(imageUrl || '').trim() || null

  const embed: Record<string, unknown> = {
    title,
    url: steamUrl,
    description: buildEmbedDescription(shortDescription),
    color: 0x57f287,
    fields: appIdStr ? [{ name: 'Steam AppID', value: appIdStr, inline: false }] : [],
    footer: { text: 'OpenSteam' },
    timestamp: new Date().toISOString(),
  }

  if (headerImage) embed.image = { url: headerImage }
  return embed
}

/** Fire-and-forget announcement for new games (dashboard/API uploads). */
export async function announceGameAdded({
  appId,
  gameName,
  imageUrl,
  shortDescription,
}: {
  appId: string
  gameName: string
  imageUrl?: string | null
  shortDescription?: string | null
}) {
  const channelId = await getAddedGamesChannelId()
  if (!channelId) return { ok: false, skipped: true as const, reason: 'no_channel' }

  const token = await getBotToken()
  if (!token) {
    console.warn('[GameAdded] DISCORD_BOT_TOKEN not configured — cannot announce.')
    return { ok: false, skipped: true as const, reason: 'no_token' }
  }

  let resolvedName = gameName
  let resolvedImage = imageUrl
  let resolvedDesc = shortDescription
  if (isPlaceholderManifestName(gameName) || !imageUrl || !shortDescription) {
    const steam = await fetchSteamStoreMeta(appId)
    if (isPlaceholderManifestName(gameName)) {
      resolvedName = steam?.gameName || gameName
    }
    if (!resolvedImage) resolvedImage = steam?.imageUrl || null
    if (!resolvedDesc) resolvedDesc = steam?.shortDescription || null
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [
          buildGameAddedEmbedPayload({
            appId,
            gameName: resolvedName,
            imageUrl: resolvedImage,
            shortDescription: resolvedDesc,
          }),
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Discord HTTP ${response.status}: ${body.slice(0, 200)}`)
    }

    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[GameAdded] Failed to post announcement:', message)
    return { ok: false as const, error: message }
  }
}
