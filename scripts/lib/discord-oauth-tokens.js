const axios = require('axios');

async function resolveDiscordOAuthCredentials(prisma) {
  const [clientConfig, secretConfig] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: 'DISCORD_CLIENT_ID' } }),
    prisma.systemConfig.findUnique({ where: { key: 'DISCORD_CLIENT_SECRET' } }),
  ]);

  return {
    clientId: process.env.DISCORD_CLIENT_ID || clientConfig?.value || null,
    clientSecret: process.env.DISCORD_CLIENT_SECRET || secretConfig?.value || null,
  };
}

async function persistDiscordOAuthTokens(prisma, discordId, accessToken, refreshToken) {
  if (!accessToken && !refreshToken) return false;

  const data = {};
  if (accessToken) data.discordAccessToken = accessToken;
  if (refreshToken) data.discordRefreshToken = refreshToken;

  const result = await prisma.user.updateMany({
    where: { discordId },
    data,
  });

  return result.count > 0;
}

async function refreshDiscordAccessToken(prisma, discordId, refreshToken, credentials) {
  const clientId = credentials?.clientId;
  const clientSecret = credentials?.clientSecret;
  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await axios.post('https://discord.com/api/oauth2/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });

    if (res.status !== 200 || !res.data?.access_token) {
      console.warn('[Discord OAuth] Refresh failed for', discordId, res.data?.error || res.status);
      return null;
    }

    await persistDiscordOAuthTokens(
      prisma,
      discordId,
      res.data.access_token,
      res.data.refresh_token || refreshToken
    );

    return res.data.access_token;
  } catch (err) {
    console.warn('[Discord OAuth] Refresh error for', discordId, err.message);
    return null;
  }
}

async function getValidDiscordAccessToken(prisma, user, credentials) {
  if (user.discordAccessToken) {
    return user.discordAccessToken;
  }

  if (user.discordRefreshToken) {
    return refreshDiscordAccessToken(prisma, user.discordId, user.discordRefreshToken, credentials);
  }

  return null;
}

function isTokenFailure(status, data) {
  if (status === 401) return true;
  if (status !== 403) return false;

  const code = data?.code;
  return code === 50025 || code === 50001 || code === 50013;
}

async function addGuildMemberWithOAuth({ guildId, botToken, user, prisma, credentials }) {
  const tryAdd = async (accessToken) =>
    axios.put(
      `https://discord.com/api/v10/guilds/${guildId}/members/${user.discordId}`,
      { access_token: accessToken },
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      }
    );

  let accessToken = await getValidDiscordAccessToken(prisma, user, credentials);
  if (!accessToken) {
    return { ok: false, reason: 'no-token' };
  }

  let res = await tryAdd(accessToken);
  if (res.status === 201) {
    return { ok: true, outcome: 'joined' };
  }
  if (res.status === 204) {
    return { ok: true, outcome: 'already-member' };
  }

  if (isTokenFailure(res.status, res.data) && user.discordRefreshToken) {
    const freshToken = await refreshDiscordAccessToken(
      prisma,
      user.discordId,
      user.discordRefreshToken,
      credentials
    );

    if (freshToken) {
      res = await tryAdd(freshToken);
      if (res.status === 201) {
        return { ok: true, outcome: 'joined', refreshed: true };
      }
      if (res.status === 204) {
        return { ok: true, outcome: 'already-member', refreshed: true };
      }
    }
  }

  return {
    ok: false,
    reason: 'api-error',
    status: res.status,
    code: res.data?.code,
    message: res.data?.message || res.statusText,
  };
}

const PULLBACK_USER_SELECT = {
  id: true,
  discordId: true,
  username: true,
  discordAccessToken: true,
  discordRefreshToken: true,
};

async function runDiscordPullback(prisma, options = {}) {
  const userId = options.userId ? String(options.userId).replace(/[<@!>]/g, '').trim() : null;
  const verifiedOnly = Boolean(options.verifiedOnly);

  const guildId =
    options.guildId?.trim() ||
    (await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }))?.value?.trim() ||
    process.env.TARGET_GUILD_ID?.trim() ||
    process.env.DISCORD_GUILD_ID?.trim() ||
    '';

  const botToken =
    options.botToken?.trim() ||
    (await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } }))?.value?.trim() ||
    process.env.OLD_DISCORD_BOT_TOKEN?.trim() ||
    process.env.DISCORD_BOT_TOKEN?.trim() ||
    '';

  const oauthCredentials = options.credentials || (await resolveDiscordOAuthCredentials(prisma));

  if (!guildId || !botToken) {
    return { ok: false, error: 'Missing Guild ID or Bot Token in system config.' };
  }

  if (!oauthCredentials.clientId || !oauthCredentials.clientSecret) {
    return {
      ok: false,
      error: 'Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET (env or Admin settings).',
    };
  }

  let usersWithTokens;
  if (Array.isArray(options.users)) {
    usersWithTokens = options.users;
  } else if (userId) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { discordId: userId }] },
      select: PULLBACK_USER_SELECT,
    });
    if (!user) {
      return { ok: false, error: 'User not found. Provide a valid OpenSteam user ID or Discord ID.' };
    }
    if (!user.discordAccessToken && !user.discordRefreshToken) {
      return {
        ok: false,
        error: 'User has no saved Discord OAuth tokens. They must sign in to OpenSteam again (guilds.join scope).',
      };
    }
    usersWithTokens = [user];
  } else {
    usersWithTokens = await prisma.user.findMany({
      where: {
        ...(verifiedOnly ? { discordVerifiedAt: { not: null } } : {}),
        OR: [{ discordAccessToken: { not: null } }, { discordRefreshToken: { not: null } }],
      },
      select: PULLBACK_USER_SELECT,
    });
    if (usersWithTokens.length === 0) {
      return {
        ok: false,
        error: verifiedOnly
          ? 'No verified users found with saved Discord OAuth tokens.'
          : 'No users found with saved Discord OAuth tokens.',
      };
    }
  }

  let joined = 0;
  let alreadyMember = 0;
  let failed = 0;
  let expired = 0;
  const failureSamples = [];

  for (const u of usersWithTokens) {
    try {
      const result = await addGuildMemberWithOAuth({
        guildId,
        botToken,
        user: u,
        prisma,
        credentials: oauthCredentials,
      });

      if (result.ok) {
        if (result.outcome === 'joined') joined++;
        else alreadyMember++;
      } else if (result.reason === 'no-token') {
        expired++;
      } else if (result.status === 401 || result.code === 50025) {
        expired++;
      } else {
        failed++;
        if (failureSamples.length < 5) {
          failureSamples.push(
            `${u.username || u.discordId}: ${result.status || '?'} ${result.message || result.reason || 'unknown'}`
          );
        }
      }
    } catch (err) {
      failed++;
      if (failureSamples.length < 5) {
        failureSamples.push(`${u.username || u.discordId}: ${err.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    ok: true,
    total: usersWithTokens.length,
    joined,
    alreadyMember,
    expired,
    failed,
    failureSamples,
    targetUser: userId ? usersWithTokens[0] : null,
    guildId,
  };
}

module.exports = {
  resolveDiscordOAuthCredentials,
  persistDiscordOAuthTokens,
  refreshDiscordAccessToken,
  getValidDiscordAccessToken,
  addGuildMemberWithOAuth,
  runDiscordPullback,
};
