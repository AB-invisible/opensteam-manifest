const INTERVAL_MS = 10 * 60 * 1000;

let keepAliveUserId = null;
let keepAliveMessageId = null;

function resolvePublicUrl() {
  const explicit = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const render = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (render) return render;
  return null;
}

async function pingPublicHealth(pathSuffix = '/') {
  const base = resolvePublicUrl();
  if (!base) return;
  const path = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) console.warn('[KeepAlive] Public health ping failed');
}

async function resolveKeepAliveUser(client) {
  if (keepAliveUserId) return keepAliveUserId;

  const configured = (process.env.KEEPALIVE_USER_ID || '').trim();
  if (configured) {
    keepAliveUserId = configured;
    return keepAliveUserId;
  }

  const username = (process.env.KEEPALIVE_USERNAME || 'itz.seasonn').trim().toLowerCase();
  const guildId = (process.env.KEEPALIVE_GUILD_ID || process.env.DISCORD_GUILD_ID || '').trim();
  if (!guildId) return null;

  const guild =
    client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    console.warn('[KeepAlive] Guild not found for user lookup');
    return null;
  }

  const query = username.replace(/^@/, '');
  const members = await guild.members.fetch({ query, limit: 20 }).catch(() => null);
  if (!members) return null;

  const match = members.find((m) => {
    const u = m.user.username.toLowerCase();
    const g = (m.user.globalName || '').toLowerCase();
    return u === query || g === query || u.includes(query) || query.includes(u);
  });

  if (!match) {
    console.warn(`[KeepAlive] User @${query} not found in guild`);
    return null;
  }

  keepAliveUserId = match.id;
  console.log(`[KeepAlive] Resolved @${match.user.username} → ${keepAliveUserId}`);
  return keepAliveUserId;
}

async function pingDiscordChannel(client) {
  const channelId = (process.env.KEEPALIVE_CHANNEL_ID || '1533279676037075005').trim();
  if (!channelId) return;

  const userId = await resolveKeepAliveUser(client);
  if (!userId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[KeepAlive] Channel ${channelId} not found or not text`);
    return;
  }

  if (keepAliveMessageId) {
    await channel.messages.delete(keepAliveMessageId).catch(() => {
      keepAliveMessageId = null;
    });
  }

  const msg = await channel.send(`<@${userId}>`);
  keepAliveMessageId = msg.id;
}

async function tickBot(client) {
  const healthPath = (process.env.KEEPALIVE_HEALTH_PATH || '/health').trim() || '/health';
  await pingPublicHealth(healthPath);
  await pingDiscordChannel(client);
}

/** HTTP-only keep-alive for the Next.js web service. */
function startHttpKeepAlive() {
  if (!process.env.RENDER_EXTERNAL_URL && process.env.KEEPALIVE_ENABLED !== 'true') return;
  console.log(`[KeepAlive] Web HTTP ping every ${INTERVAL_MS / 60_000}m`);
  const run = () => pingPublicHealth('/').catch((e) => console.warn('[KeepAlive]', e.message));
  run();
  setInterval(run, INTERVAL_MS);
}

/** Bot service: HTTP ping + channel user ping only. */
function startRenderKeepAlive(client) {
  if (!process.env.RENDER_EXTERNAL_URL && process.env.KEEPALIVE_ENABLED !== 'true') return;
  const channelId = process.env.KEEPALIVE_CHANNEL_ID || '1533279676037075005';
  const healthPath = (process.env.KEEPALIVE_HEALTH_PATH || '/health').trim() || '/health';
  console.log(
    `[KeepAlive] Every ${INTERVAL_MS / 60_000}m — ${healthPath} + ping @${process.env.KEEPALIVE_USERNAME || 'itz.seasonn'} in ${channelId}`,
  );
  tickBot(client).catch((e) => console.warn('[KeepAlive] First tick failed:', e.message));
  setInterval(() => {
    tickBot(client).catch((e) => console.warn('[KeepAlive] Tick failed:', e.message));
  }, INTERVAL_MS);
}

module.exports = { startHttpKeepAlive, startRenderKeepAlive };
