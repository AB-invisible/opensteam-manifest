require('dotenv').config();
const { readSiteSettings } = require('./lib/site-settings');

const clientId = process.env.DISCORD_CLIENT_ID || 'UNKNOWN';
const nextAuthUrl = (process.env.NEXTAUTH_URL || 'http://opensteam.lol').replace(/\/$/, '');
const publicUrl = (readSiteSettings().siteUrl || process.env.NEXT_PUBLIC_APP_URL || nextAuthUrl).replace(/\/$/, '');

const required = `${nextAuthUrl}/api/auth/callback/discord`;

const redirects = [
  required,
  'http://opensteam.lol/api/auth/callback/discord',
  'https://opensteam.lol/api/auth/callback/discord',
  'http://127.0.0.1:3000/api/auth/callback/discord',
  'http://localhost:3000/api/auth/callback/discord',
];

console.log('\n=== OpenSteam Discord OAuth setup ===\n');
console.log(`App Client ID (gen): ${clientId}`);
console.log(`NEXTAUTH_URL: ${nextAuthUrl}`);
console.log('\n*** REQUIRED redirect (copy exactly) ***');
console.log(required);
console.log('\nAdd these in Discord Developer Portal → gen app → OAuth2 → Redirects:');
for (const uri of [...new Set(redirects)]) {
  console.log(`  ${uri}`);
}
console.log('\nOpen site with http:// (not https): http://opensteam.lol');
console.log('Wrong app? Use gen app 1532867690031484969, NOT denuvo 1532601026019065856\n');
