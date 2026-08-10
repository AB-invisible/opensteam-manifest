/**
 * Post a DepotBox-style embed when a new manifest/game is added to OpenSteam.
 */
const axios = require('axios');
const { enrichAnnouncementPayload } = require('./steam-store-meta');

const DISCORD_ADDED_GAMES_CHANNEL_KEY = 'DISCORD_ADDED_GAMES_CHANNEL_ID';

async function getAddedGamesChannelId(prisma) {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: DISCORD_ADDED_GAMES_CHANNEL_KEY },
    });
    const fromDb = row?.value?.trim();
    if (fromDb) return fromDb;
  } catch (e) {
    console.warn('[GameAdded] Could not read channel id from DB:', e?.message || e);
  }
  return process.env.DISCORD_ADDED_GAMES_CHANNEL_ID?.trim() || '';
}

async function getBotToken(prisma) {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: 'DISCORD_BOT_TOKEN' },
    });
    if (row?.value?.trim()) return row.value.trim();
  } catch (_) {
    /* ignore */
  }
  return process.env.DISCORD_BOT_TOKEN?.trim() || '';
}

function truncateText(text, max = 280) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function buildEmbedDescription(shortDescription) {
  const lead = '1 game has been added to OpenSteam.';
  const snippet = truncateText(shortDescription);
  return snippet ? `${lead}\n\n${snippet}` : lead;
}

function buildGameAddedEmbedPayload({ appId, gameName, imageUrl, shortDescription }) {
  const appIdStr = String(appId || '').trim();
  const steamUrl = appIdStr ? `https://store.steampowered.com/app/${appIdStr}` : undefined;
  const title = String(gameName || '').trim() || (appIdStr ? `App ${appIdStr}` : 'New Game');
  const headerImage =
    imageUrl ||
    (appIdStr ? `https://cdn.akamai.steamstatic.com/steam/apps/${appIdStr}/header.jpg` : null);

  const embed = {
    title,
    url: steamUrl,
    description: buildEmbedDescription(shortDescription),
    color: 0x57f287,
    fields: appIdStr ? [{ name: 'Steam AppID', value: appIdStr, inline: false }] : [],
    footer: { text: 'OpenSteam' },
    timestamp: new Date().toISOString(),
  };

  if (headerImage) embed.image = { url: headerImage };
  return embed;
}

async function announceGameAddedViaRest(prisma, payload = {}) {
  const channelId = await getAddedGamesChannelId(prisma);
  if (!channelId) return { ok: false, skipped: true, reason: 'no_channel' };

  const token = await getBotToken(prisma);
  if (!token) {
    console.warn('[GameAdded] DISCORD_BOT_TOKEN not configured — cannot announce.');
    return { ok: false, skipped: true, reason: 'no_token' };
  }

  const enriched = await enrichAnnouncementPayload(payload);

  try {
    const res = await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      { embeds: [buildGameAddedEmbedPayload(enriched)] },
      {
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
        validateStatus: () => true,
      },
    );

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Discord HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GameAdded] Failed to post announcement:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Prefer discord.js client when the bot process has one; fall back to REST.
 */
async function announceGameAdded(client, prisma, payload = {}) {
  const channelId = await getAddedGamesChannelId(prisma);
  if (!channelId) return { ok: false, skipped: true, reason: 'no_channel' };

  const enriched = await enrichAnnouncementPayload(payload);

  if (client?.channels?.fetch) {
    try {
      const { EmbedBuilder } = require('discord.js');
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased?.() || typeof channel.send !== 'function') {
        return announceGameAddedViaRest(prisma, enriched);
      }

      const embedPayload = buildGameAddedEmbedPayload(enriched);
      const embed = new EmbedBuilder()
        .setTitle(embedPayload.title)
        .setDescription(embedPayload.description)
        .setColor(embedPayload.color)
        .setFooter(embedPayload.footer)
        .setTimestamp(new Date(embedPayload.timestamp));

      if (embedPayload.url) embed.setURL(embedPayload.url);
      if (embedPayload.fields?.length) {
        for (const field of embedPayload.fields) {
          embed.addFields({ name: field.name, value: field.value, inline: field.inline ?? false });
        }
      }
      if (embedPayload.image?.url) embed.setImage(embedPayload.image.url);

      await channel.send({ embeds: [embed] });
      return { ok: true };
    } catch (e) {
      console.warn('[GameAdded] Client send failed, falling back to REST:', e?.message || e);
    }
  }

  return announceGameAddedViaRest(prisma, enriched);
}

module.exports = {
  DISCORD_ADDED_GAMES_CHANNEL_KEY,
  getAddedGamesChannelId,
  buildGameAddedEmbedPayload,
  announceGameAdded,
  announceGameAddedViaRest,
};
