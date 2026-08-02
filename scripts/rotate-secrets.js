require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomBase64(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64');
}

function updateEnv(key, value) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}="${escaped}"`;
    }
    return line;
  });
  if (!found) out.push(`${key}="${escaped}"`);
  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8');
}

if (!fs.existsSync(envPath)) {
  console.error('.env missing — run setup first');
  process.exit(1);
}

const rotated = {
  ADMIN_API_KEY: randomSecret(24),
  NEXTAUTH_SECRET: randomBase64(32),
  INTERNAL_SERVICE_SECRET: randomSecret(32),
  HOSTED_BOT_ENCRYPTION_KEY: randomSecret(32),
  CRON_SECRET: randomBase64(32),
  TELEGRAM_WEBHOOK_SECRET: randomBase64(32),
  RESEND_WEBHOOK_SECRET: randomBase64(32),
  WHOP_WEBHOOK_SECRET: `ws_${randomSecret(32)}`,
};

for (const [key, value] of Object.entries(rotated)) {
  updateEnv(key, value);
  console.log(`Rotated ${key}`);
}

console.log('All shared-repo secrets rotated. Old .env.example values no longer work on this install.');
