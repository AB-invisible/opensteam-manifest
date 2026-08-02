#!/usr/bin/env node
/**
 * Deploy manifest stack to Render (manifest-web + manifest-bot + env injection).
 *
 * Requires RENDER_API_KEY in .env (or ~/.render/cli.yaml is read as fallback).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.render.com/v1';

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
  'NEON_DATABASE_URL',
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

function getRenderApiKey() {
  const fromEnv = process.env.RENDER_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const cliPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.render', 'cli.yaml');
  if (!fs.existsSync(cliPath)) return null;
  const m = fs.readFileSync(cliPath, 'utf8').match(/key:\s*(rnd_[^\s]+)/);
  return m?.[1] || null;
}

async function api(method, pathSuffix, body) {
  const key = getRenderApiKey();
  if (!key) throw new Error('RENDER_API_KEY missing in .env');
  const res = await fetch(`${API}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Render API ${method} ${pathSuffix} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function listServices() {
  return (await api('GET', '/services?limit=100')) || [];
}

async function findService(name) {
  const services = await listServices();
  return services.find((s) => s.service?.name === name)?.service
    || services.find((s) => s.name === name);
}

async function findPostgresDb(name) {
  const rows = (await api('GET', '/postgres?limit=100')) || [];
  return rows.find((r) => r.postgres?.name === name)?.postgres || rows.find((r) => r.name === name);
}

async function resolveDatabaseUrl(localEnv = {}) {
  const neon =
    (localEnv.NEON_DATABASE_URL || process.env.NEON_DATABASE_URL || '').trim();
  if (neon && !/127\.0\.0\.1|localhost/i.test(neon)) return neon;

  const dbUrl = (localEnv.DATABASE_URL || '').trim();
  if (dbUrl && !/127\.0\.0\.1|localhost/i.test(dbUrl)) return dbUrl;

  const db = await findPostgresDb('manifest-db');
  if (!db?.id) return null;
  const info = await api('GET', `/postgres/${db.id}/connection-info`);
  return info?.internalConnectionString || info?.externalConnectionString || null;
}

async function patchServiceEnv(serviceId, envVars) {
  return api('PUT', `/services/${serviceId}/env-vars`, envVars.map(({ key, value }) => ({ key, value })));
}

async function triggerDeploy(serviceId) {
  return api('POST', `/services/${serviceId}/deploys`, {});
}

function buildEnvList(localEnv, extra = {}) {
  const merged = { ...localEnv, ...extra };
  const list = ENV_KEYS.filter((k) => merged[k]).map((k) => ({ key: k, value: merged[k] }));
  list.push({ key: 'NODE_ENV', value: 'production' });
  return list;
}

async function setupService(name, localEnv, extra = {}) {
  const service = await findService(name);
  if (!service) {
    console.log(`[setup-render] ${name} not found — create via Blueprint first.`);
    return null;
  }
  const envVars = buildEnvList(localEnv, extra);
  const dbUrl = await resolveDatabaseUrl(localEnv);
  if (dbUrl) envVars.push({ key: 'DATABASE_URL', value: dbUrl });

  console.log(`[setup-render] Patching ${name} (${envVars.length} vars)...`);
  await patchServiceEnv(service.id, envVars);
  await triggerDeploy(service.id);
  const url = service.serviceDetails?.url || service.url;
  console.log(`[setup-render] ${name} deploy triggered → ${url || '(pending)'}`);
  return { service, url };
}

async function main() {
  console.log('[setup-render] Reading local .env...');
  const localEnv = cloudify(parseEnvFile(path.join(ROOT, '.env')));

  if (!localEnv.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN missing in .env');
  }
  if (!getRenderApiKey()) {
    console.error('Add RENDER_API_KEY to .env or run: render login');
    process.exit(1);
  }

  const web = await setupService('manifest-web', localEnv);
  const webUrl = web?.url;
  const botExtra = {};
  if (webUrl) {
    botExtra.INTERNAL_APP_URL = webUrl;
    botExtra.MANIFEST_UPLOAD_BASE_URL = webUrl;
    botExtra.NEXTAUTH_URL = webUrl;
    botExtra.NEXT_PUBLIC_APP_URL = webUrl;
  }
  await setupService('manifest-bot', localEnv, botExtra);

  if (webUrl) {
    console.log(`[setup-render] Update Discord OAuth redirect: ${webUrl}/api/auth/callback/discord`);
  }

  if (process.platform === 'win32') {
    console.log('[setup-render] Stopping local PM2 manifest stack...');
    spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      "pm2 stop manifest-web,manifest-bot,manifest-tunnel,manifest-https -ErrorAction SilentlyContinue; pm2 save",
    ], { stdio: 'inherit' });
  }

  console.log('[setup-render] Done.');
}

main().catch((err) => {
  console.error('[setup-render] FAILED:', err.message || err);
  process.exit(1);
});
