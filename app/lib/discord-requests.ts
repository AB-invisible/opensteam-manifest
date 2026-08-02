import { prisma } from './prisma'

const REQUESTS_CHANNEL_ID = '1484100666023477308'

function truncate(text: string, max = 320) {
  const value = String(text || '').trim()
  if (!value) return ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

async function fetchSteamBasic(appId: string) {
  try {
    const steamRes = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic&l=english&cc=us`,
    )
    const steamData = await steamRes.json()
    if (steamData[appId]?.success) {
      return steamData[appId].data as {
        name?: string
        short_description?: string
        header_image?: string
        developers?: string[]
        publishers?: string[]
      }
    }
  } catch (e) {
    console.error('[Discord Request] Steam API error:', e)
  }
  return null
}

/**
 * Sends a rich embed for a new game request to the dedicated Discord channel.
 */
export async function sendDiscordGameRequest(requestId: string) {
  try {
    const request = await prisma.gameRequest.findUnique({
      where: { id: requestId },
      include: { user: true }
    })
    if (!request) return

    const tokenCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
    if (!tokenCfg?.value) return

    // Fetch Steam info if appId exists
    let gameName = request.name
    let steamUrl: string | null = null
    let headerImage: string | null = null
    let steamInfo: Awaited<ReturnType<typeof fetchSteamBasic>> = null
    if (request.appId) {
      steamInfo = await fetchSteamBasic(request.appId)
      if (steamInfo) {
        gameName = steamInfo.name || gameName
        steamUrl = `https://store.steampowered.com/app/${request.appId}`
        headerImage = steamInfo.header_image || null
      }
    }

    const embed = {
      title: `🎮 New Game Request · ${gameName}`,
      url: steamUrl || undefined,
      description:
        truncate(steamInfo?.short_description || '') ||
        request.reason?.replace(/^\[Discord\]\s*/i, '') ||
        'No additional details provided.',
      color: 0x6366f1,
      fields: [
        { name: 'App ID', value: request.appId ? `\`${request.appId}\`` : 'N/A', inline: true },
        { name: 'Requester', value: `<@${request.user.discordId}>`, inline: true },
        { name: 'Status', value: '⏳ **PENDING**', inline: true },
      ],
      thumbnail: headerImage ? { url: headerImage } : undefined,
      timestamp: new Date().toISOString(),
      footer: { text: 'OpenSteam Request Pipeline' },
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${REQUESTS_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${tokenCfg.value}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: `📫 **New Request** from <@${request.user.discordId}>`,
        embeds: [embed]
      })
    })

    if (response.ok) {
      const data = await response.json()
      await prisma.gameRequest.update({
        where: { id: requestId },
        data: {
          discordMessageId: data.id,
          discordChannelId: REQUESTS_CHANNEL_ID
        } as any
      })
    } else {
      const err = await response.text()
      console.error('[Discord Request] Failed to send message:', err)
    }
  } catch (error) {
    console.error('[Discord Request Error]', error)
  }
}

/**
 * Updates an existing Discord request message with its new status and pings the requester if added.
 */
export async function updateDiscordGameRequest(requestId: string) {
  try {
    const request = await prisma.gameRequest.findUnique({
      where: { id: requestId },
      include: { user: true }
    }) as any
    if (!request || !request.discordMessageId || !request.discordChannelId) return

    const tokenCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
    if (!tokenCfg?.value) return

    const isAdded = ['DONE', 'FULFILLED'].includes(request.status)
    const isRejected = request.status === 'REJECTED'

    const steamInfo = request.appId ? await fetchSteamBasic(request.appId) : null
    const displayName = steamInfo?.name || request.name

    const color = isAdded ? 0x10b981 : isRejected ? 0xef4444 : 0x6366f1
    const statusText = isAdded
      ? '✅ **FULFILLED**'
      : isRejected
        ? '❌ **REJECTED**'
        : '⏳ **PENDING**'

    const embed: Record<string, unknown> = {
      title: isAdded
        ? `✅ Fulfilled · ${displayName}`
        : isRejected
          ? `❌ Request Rejected · ${displayName}`
          : `🎮 Game Request · ${displayName}`,
      url: request.appId ? `https://store.steampowered.com/app/${request.appId}` : undefined,
      description: isAdded
        ? truncate(steamInfo?.short_description || '') ||
          'Indexed and is now available in the manifest database.'
        : truncate(request.reason?.replace(/^\[Discord\]\s*/i, '') || '') || 'No additional details provided.',
      color,
      fields: [
        { name: 'App ID', value: request.appId ? `\`${request.appId}\`` : 'N/A', inline: true },
        { name: 'Requester', value: `<@${request.user.discordId}>`, inline: true },
        { name: 'Status', value: statusText, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OpenSteam Request Pipeline' },
    }

    if (steamInfo?.developers?.[0]) {
      ;(embed.fields as Array<{ name: string; value: string; inline: boolean }>).push({
        name: 'Developer',
        value: truncate(steamInfo.developers[0], 64),
        inline: true,
      })
    }
    if (steamInfo?.publishers?.[0]) {
      ;(embed.fields as Array<{ name: string; value: string; inline: boolean }>).push({
        name: 'Publisher',
        value: truncate(steamInfo.publishers[0], 64),
        inline: true,
      })
    }
    if (steamInfo?.header_image) {
      embed.thumbnail = { url: steamInfo.header_image }
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${request.discordChannelId}/messages/${request.discordMessageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${tokenCfg.value}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: isAdded
          ? `🔔 <@${request.user.discordId}>, **${displayName}** has been added to the manifest database!`
          : undefined,
        embeds: [embed]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[Discord Update] Failed to update message:', err)
    }

  } catch (error) {
    console.error('[Discord Update Error]', error)
  }
}
