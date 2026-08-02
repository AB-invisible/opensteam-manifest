require('dotenv').config();

const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!clientId) {
  console.error('DISCORD_CLIENT_ID missing from .env');
  process.exit(1);
}

const params = new URLSearchParams({
  client_id: clientId,
  permissions: '8',
  scope: 'bot applications.commands',
});
if (guildId) params.set('guild_id', guildId);
params.set('disable_guild_select', 'true');

const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
console.log('\nInvite the manifest platform bot to your server (required once):\n');
console.log(url);
console.log('\nAfter inviting, run: node scripts/register-commands.js\n');
