#!/usr/bin/env node
/**
 * Push .env vars to Railway (skips local-only keys).
 * Usage: node scripts/railway-sync-env.js [--service opensteam-web|opensteam-bot]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');

const SKIP = new Set([
  'PUBLIC_TUNNEL_URL',
  'INTERNAL_APP_URL',
  'MANIFEST_UPLOAD_BASE_URL',
  'DATABASE_URL', // set via Postgres reference on Railway
]);

const SERVICE_OVERRIDES = {
  'opensteam-web': {
    SKIP_ENSURE_BOT: '1',
    SKIP_HOSTED_BOTS: '1',
    TRUSTED_PROXY: 'railway',
    NODE_ENV: 'production',
    AUTH_TRUST_HOST: 'true',
  },
  'opensteam-bot': {
    SKIP_ENSURE_BOT: '1',
    NODE_ENV: 'production',
    NODE_OPTIONS: '--use-system-ca',
    INTERNAL_APP_URL: 'http://${{opensteam-web.RAILWAY_PRIVATE_DOMAIN}}:${{opensteam-web.PORT}}',
    MANIFEST_UPLOAD_BASE_URL: 'http://${{opensteam-web.RAILWAY_PRIVATE_DOMAIN}}:${{opensteam-web.PORT}}',
  },
};

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val.includes('${{')) continue; // skip Railway template placeholders from old .env
    out[m[1]] = val;
  }
  return out;
}

function main() {
  const serviceArg = process.argv.find((a) => a.startsWith('--service='));
  const service = serviceArg ? serviceArg.split('=')[1] : process.env.RAILWAY_SERVICE;

  if (!fs.existsSync(envPath)) {
    console.error('Missing .env at', envPath);
    process.exit(1);
  }

  const parsed = parseEnv(envPath);
  const overrides = service ? SERVICE_OVERRIDES[service] || {} : {};

  const pairs = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (SKIP.has(key)) continue;
    if (value === '' || value == null) continue;
    pairs.push(`${key}=${value}`);
  }
  for (const [key, value] of Object.entries(overrides)) {
    pairs.push(`${key}=${value}`);
  }

  if (service) {
    pairs.push(`DATABASE_URL=\${{Postgres.DATABASE_URL}}`);
  }

  console.log(`Syncing ${pairs.length} variables${service ? ` to ${service}` : ''}...`);

  const chunkSize = 15;
  for (let i = 0; i < pairs.length; i += chunkSize) {
    const chunk = pairs.slice(i, i + chunkSize);
    const args = chunk.flatMap((p) => ['--set', p]).join(' ');
    const cmd = service
      ? `railway variables ${args} --service "${service}"`
      : `railway variables ${args}`;
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
  }

  console.log('Done.');
}

main();
