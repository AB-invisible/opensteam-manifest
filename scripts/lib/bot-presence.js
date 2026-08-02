const { ActivityType } = require('discord.js');
const { NETWORK_NAME } = require('./brand');

async function applyOpenSteamListeningPresence(client) {
  if (!client?.user) return;
  try {
    await client.user.setPresence({
      activities: [{ name: NETWORK_NAME, type: ActivityType.Listening }],
      status: 'online',
    });
  } catch (err) {
    console.warn('[Bot Presence] Failed to set activity:', err?.message || err);
  }
}

module.exports = { applyOpenSteamListeningPresence, ACTIVITY_NAME: NETWORK_NAME };
