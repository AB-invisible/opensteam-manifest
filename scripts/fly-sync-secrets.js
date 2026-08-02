#!/usr/bin/env node
/** Write Fly secrets import file from .env (no secrets printed). */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const outPath = path.join(__dirname, '..', '.fly.secrets');

const SKIP = new Set(['PUBLIC_TUNNEL_URL', 'DATABASE_URL']);
const FORCE = {
  DATABASE_URL: process.env.NEON_DATABASE_URL || process.argv[2] || '',
  INTERNAL_APP_URL: 'http://127.0.0.1:3000',
  MANIFEST_UPLOAD_BASE_URL: 'http://127.0.0.1:3000',
  SKIP_ENSURE_BOT: '1',
  SKIP_HOSTED_BOTS: '1',
  TRUSTED_PROXY: 'fly',
  NODE_ENV: 'production',
  AUTH_TRUST_HOST: 'true',
  NODE_OPTIONS: '--use-system-ca',
};

const lines = [];
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const m = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let val = m[2].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (SKIP.has(m[1]) || val.includes('${{')) continue;
  if (val) lines.push(`${m[1]}=${val}`);
}
for (const [k, v] of Object.entries(FORCE)) {
  if (v) lines.push(`${k}=${v}`);
}

fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`Wrote ${lines.length} secrets to ${outPath}`);
