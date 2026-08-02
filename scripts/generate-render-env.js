#!/usr/bin/env node
/**
 * Build dist/render-env.txt from .env for Render dashboard.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT = path.join(ROOT, 'dist', 'render-env.txt');

const ENV_KEYS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_BACKUP_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'DISCORD_BACKUP_CLIENT_ID',
  'DISCORD_BACKUP_CLIENT_SECRET',
  'DISCORD_MANIFEST_UPLOAD_CHANNEL_ID',
  'DISCORD_GAME_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'INTERNAL_APP_URL',
  'MANIFEST_UPLOAD_BASE_URL',
  'ADMIN_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'STEAM_API_KEY',
  'RYUU_API_KEY',
  'MORRENUS_API_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'RESEND_WEBHOOK_SECRET',
  'WHOP_API_KEY',
  'WHOP_WEBHOOK_SECRET',
  'WHOP_PLAN_REGULAR',
  'WHOP_PLAN_PREMIUM',
  'WHOP_PLAN_RESELLER',
  'WHOP_PLAN_BUSINESS',
  'WHOP_PLAN_UNBAN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_PUBLIC_CHANNEL_ID',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CHANNEL_ID',
  'VAULTCORD_API_KEY',
  'INTERNAL_SERVICE_SECRET',
  'HOSTED_BOT_ENCRYPTION_KEY',
  'CRON_SECRET',
  'AUTH_TRUST_HOST',
  'USER_EMAILS_ENABLED',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_DEFAULT_REGION',
  'AWS_ENDPOINT_URL',
  'AWS_S3_BUCKET_NAME',
  'BUCKET_TYPE',
  'STORAGE_PATH',
  'STORAGE_SYNC_ON_START',
  'KEEPALIVE_CHANNEL_ID',
  'KEEPALIVE_USERNAME',
  'KEEPALIVE_USER_ID',
  'KEEPALIVE_GUILD_ID',
  'SKIP_ENSURE_BOT',
  'SKIP_HOSTED_BOTS',
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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
    out[key] = val;
  }
  return out;
}

function cloudify(env) {
  const out = { ...env };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && (v.includes('${{') || v.includes('indexed-shelf.'))) delete out[k];
  }
  out.BUCKET_TYPE = 's3';
  out.STORAGE_PATH = '/tmp/data';
  out.STORAGE_SYNC_ON_START = '0';
  out.SKIP_ENSURE_BOT = '1';
  out.SKIP_HOSTED_BOTS = '1';
  out.USER_EMAILS_ENABLED = out.USER_EMAILS_ENABLED || 'false';
  out.NODE_ENV = 'production';
  out.KEEPALIVE_CHANNEL_ID = out.KEEPALIVE_CHANNEL_ID || '1533279676037075005';
  out.KEEPALIVE_USERNAME = out.KEEPALIVE_USERNAME || 'itz.seasonn';
  out.KEEPALIVE_GUILD_ID = out.KEEPALIVE_GUILD_ID || out.DISCORD_GUILD_ID || '';

  for (const key of ['INTERNAL_APP_URL', 'MANIFEST_UPLOAD_BASE_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL']) {
    const v = (out[key] || '').trim();
    if (/127\.0\.0\.1|localhost|trycloudflare|loca\.lt/i.test(v)) delete out[key];
  }
  return out;
}

function main() {
  const env = cloudify(parseEnvFile(ENV_PATH));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = ENV_KEYS.filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${OUT}`);
}

main();
