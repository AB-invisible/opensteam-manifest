const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;

function getStateSecret() {
  const hex = process.env.HOSTED_BOT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('HOSTED_BOT_ENCRYPTION_KEY is required for hosted bot OAuth');
  }
  return Buffer.from(hex, 'hex');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');
}

function createHostedLinkState(linkType, guildId, discordId) {
  const payload = Buffer.from(
    JSON.stringify({
      g: guildId,
      d: discordId,
      e: Date.now() + STATE_TTL_MS,
      t: linkType,
    })
  ).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

function getGenAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000';
}

function getBrandedOAuthRedirectUrl() {
  return `${getGenAppUrl()}/api/hosted-bot/branded/oauth/callback`;
}

function getCustomOAuthRedirectUrl() {
  return `${getGenAppUrl()}/api/hosted-bot/custom/oauth/callback`;
}

function buildLinkOAuthUrl({ clientId, redirectUri, guildId, discordId, linkType }) {
  const state = createHostedLinkState(linkType, guildId, discordId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

function buildBrandedLinkOAuthUrl({ clientId, guildId, discordId }) {
  return buildLinkOAuthUrl({
    clientId,
    redirectUri: getBrandedOAuthRedirectUrl(),
    guildId,
    discordId,
    linkType: 'branded-link',
  });
}

function buildCustomLinkOAuthUrl({ clientId, guildId, discordId }) {
  return buildLinkOAuthUrl({
    clientId,
    redirectUri: getCustomOAuthRedirectUrl(),
    guildId,
    discordId,
    linkType: 'custom-link',
  });
}

module.exports = {
  buildBrandedLinkOAuthUrl,
  buildCustomLinkOAuthUrl,
  getBrandedOAuthRedirectUrl,
  getCustomOAuthRedirectUrl,
};
