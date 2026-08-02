/**
 * Sync active Discord guild invites into system_configs for gamegen.lol/discord.
 * The web app reads DISCORD_COMMUNITY_INVITE_URLS before calling Discord again.
 */

const axios = require('axios');

const CONFIG_KEY = 'DISCORD_COMMUNITY_INVITE_URLS';
const FALLBACK_INVITE = 'https://discord.gg/4RdMhcYws';

function inviteUrlFromCode(code) {
  return `https://discord.gg/${code}`;
}

function isInviteActive(invite) {
  if (!invite?.code) return false;
  if (!invite.expires_at) return true;
  return new Date(invite.expires_at).getTime() > Date.now();
}

async function fetchActiveInviteUrls(guildId, botToken) {
  const urls = new Set();
  const headers = { Authorization: `Bot ${botToken}` };

  try {
    const vanityRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/vanity-url`, {
      headers,
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (vanityRes.status >= 200 && vanityRes.status < 300 && vanityRes.data?.code) {
      urls.add(inviteUrlFromCode(vanityRes.data.code));
    }

    const invitesRes = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/invites`, {
      headers,
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (invitesRes.status >= 200 && invitesRes.status < 300 && Array.isArray(invitesRes.data)) {
      for (const invite of invitesRes.data) {
        if (isInviteActive(invite)) {
          urls.add(inviteUrlFromCode(invite.code));
        }
      }
    }
  } catch (error) {
    console.warn('[CommunityInvites] Bot sync fetch failed:', error?.message || error);
  }

  if (urls.size === 0) {
    urls.add(FALLBACK_INVITE);
  }

  return Array.from(urls);
}

async function syncCommunityInviteLinks(prisma, { guildId, botToken }) {
  if (!prisma || !guildId || !botToken) {
    return { ok: false, error: 'missing prisma, guildId, or botToken' };
  }

  const urls = await fetchActiveInviteUrls(guildId, botToken);
  const value = JSON.stringify(urls);

  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value, isSecret: false },
    create: { key: CONFIG_KEY, value, isSecret: false },
  });

  return { ok: true, urls };
}

module.exports = {
  CONFIG_KEY,
  fetchActiveInviteUrls,
  syncCommunityInviteLinks,
};
