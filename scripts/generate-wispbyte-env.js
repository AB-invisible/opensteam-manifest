#!/usr/bin/env node
/** Write dist/wispbyte-env.txt for copy-paste into Wispbyte panel (from .env only). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT = path.join(ROOT, 'dist', 'wispbyte-env.txt');

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val.includes('${{')) continue;
    out[key] = val;
  }
  return out;
}

const env = fs.existsSync(ENV_PATH)
  ? parseEnv(fs.readFileSync(ENV_PATH, 'utf8'))
  : {};

const appUrl = env.NEXT_PUBLIC_APP_URL || 'https://opensteam.lol';
const neon =
  env.NEON_DATABASE_URL ||
  process.argv[2] ||
  env.DATABASE_URL ||
  '';

const FORCE = {
  DATABASE_URL: neon,
  MANIFEST_UPLOAD_BASE_URL: appUrl,
  INTERNAL_APP_URL: appUrl,
  NODE_ENV: 'production',
  NODE_OPTIONS: '--use-system-ca',
  SKIP_ENSURE_BOT: '1',
};

const SKIP = new Set(['PUBLIC_TUNNEL_URL']);

const lines = ['# Paste into Wispbyte → Startup → Environment variables', ''];
for (const [key, value] of Object.entries(env)) {
  if (SKIP.has(key) || !value) continue;
  if (key === 'DATABASE_URL' || key === 'NEON_DATABASE_URL') continue;
  lines.push(`${key}=${value}`);
}
for (const [key, value] of Object.entries(FORCE)) {
  if (value) lines.push(`${key}=${value}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log('Wrote', OUT);
