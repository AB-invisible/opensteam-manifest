process.title = 'OpenSteam-Bot-Daemon';

const path = require('path');
const fs = require('fs');

// PID file lock to prevent duplicate concurrent bot processes (skip stale locks on cloud)
const pidFile = process.env.BOT_PID_FILE || path.join(__dirname, '../data/bot.pid');
try {
  const dataDir = path.dirname(pidFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(pidFile)) {
    const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (existingPid && existingPid !== process.pid) {
      let isRunning = false;
      try {
        process.kill(existingPid, 0);
        isRunning = true;
      } catch (e) {
        isRunning = false;
      }

      if (isRunning) {
        console.warn(`[Bot Daemon] Another instance is already running (PID ${existingPid}). Exiting duplicate process.`);
        process.exit(0);
      }
    }
  }
  fs.writeFileSync(pidFile, String(process.pid));
} catch (e) {
  console.warn('[Bot Daemon] Could not update PID lock file:', e.message);
}

process.on('exit', () => {
  try {
    if (fs.existsSync(pidFile) && parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10) === process.pid) {
      fs.unlinkSync(pidFile);
    }
  } catch (_) {}
});

const { Client, GatewayIntentBits, EmbedBuilder, Partials, AuditLogEvent, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, MessageFlags, Events, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const JSZip = require('jszip');
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const { startOtel, logToBetterStack } = require('./lib/otel-logger');
const { applyOpenSteamListeningPresence } = require('./lib/bot-presence');
const { syncYouTubeVideosToDb } = require('./lib/youtube-sync');
const {
  handleGiveawayCommand,
  handleGiveawayButton,
  processGiveawayTimers,
} = require('./lib/giveaways');
const { handleAddCommand, handleSetCommand } = require('./lib/site-admin-commands');
const {
  resolveActiveBotToken,
  resolveGuildBotToken,
} = require('./lib/discord-bot-credentials');
const {
  handleManifestUploadChannelMessage,
  getManifestUploadChannelId,
  postManifestUpload,
  uploadServerUrl,
} = require('./lib/discord-manifest-upload');
const { getAddedGamesChannelId } = require('./lib/discord-game-added');
const { getOrSyncDiscordUser } = require('./lib/discord-user-sync');
const { fetchSteamAppList, resolveAutogenAppIdFromName } = require('./lib/steam-app-list');
const { fetchManifestFromDepotBox, checkDepotBoxAvailability } = require('./lib/depotbox');
const { syncCommunityInviteLinks } = require('./lib/sync-community-invites');
const {
  buildAutogenFulfilledEmbed,
  buildAutogenSummaryEmbeds,
  buildAutogenStatusEmbed,
  buildAutogenToggleEmbed,
  buildAutogenProgressEmbed,
  buildAutogenErrorEmbed,
  buildAutogenInfoEmbed,
} = require('./lib/autogen-embeds');
const {
  SHOP_COINRAIN_AMOUNT,
  formatCoins,
  getShopItem,
  shopEmbedFields,
} = require('./lib/shop-catalog');
const { validateShopTextValue } = require('./lib/shop-safety');
const { getProtectedModerationReason } = require('./lib/mod-protection');
const { handleDiscordAiMessage } = require('./lib/discord-ai-chat');

// Initialize OpenTelemetry
startOtel();

// --- Singleton guard: only one instance may run at a time ---
// Both PM2 (manifest-bot) and start-web.js (via ensure-bot.js) try to launch
// this file. The lockfile prevents duplicate Discord clients on the same token.
const BOT_PID_FILE = path.join(__dirname, '../data/bot.pid');
try {
  if (fs.existsSync(BOT_PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(BOT_PID_FILE, 'utf8').trim(), 10);
    if (existingPid && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0); // throws if PID is not alive
        console.warn(`[Bot Daemon] Another instance is already running (PID ${existingPid}). Exiting.`);
        process.exit(0);
      } catch (_) {
        // Stale lockfile — previous process died without cleanup
      }
    }
  }
  if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  }
  fs.writeFileSync(BOT_PID_FILE, String(process.pid), 'utf8');
  const _cleanupPid = () => { try { fs.unlinkSync(BOT_PID_FILE); } catch (_) {} };
  process.on('exit', _cleanupPid);
  process.on('SIGINT', () => { _cleanupPid(); process.exit(0); });
  process.on('SIGTERM', () => { _cleanupPid(); process.exit(0); });
} catch (lockErr) {
  console.warn('[Bot Daemon] Could not acquire PID lock:', lockErr.message);
}

// --- Global crash guards ---
// This daemon is spawned detached with no supervisor/auto-restart, so a single
// unhandled rejection or uncaught exception (e.g. a transient gateway/network
// error) would silently take the whole bot offline. Log and keep running.
process.on('unhandledRejection', (reason) => {
  // Suppress Discord "Unknown interaction" (10062) — stale events after bot restarts.
  if (reason?.code === 10062 || reason?.message === 'Unknown interaction') return;
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  console.error('[Bot Daemon] Unhandled promise rejection (kept alive):', msg);
  try { logToBetterStack(`Bot daemon unhandledRejection: ${msg}`, 'ERROR'); } catch (_) {}
});

process.on('uncaughtException', (err) => {
  console.error('[Bot Daemon] Uncaught exception (kept alive):', err?.stack || err?.message || err);
  try { logToBetterStack(`Bot daemon uncaughtException: ${err?.message || err}`, 'ERROR'); } catch (_) {}
});

/**
 * Statuspage & Better Uptime Component Updates
 */
const STATUSPAGE_COMPONENTS = {
  api: 'f0fjfzrkh9j2',
  database: 'ybwzbtww2bqn'
};

const BETTER_UPTIME_HEARTBEATS = {
  api: 'https://uptime.betterstack.com/api/v1/heartbeat/mjcwR9yTen7bCEfwjkHjPXAX',
  database: 'https://uptime.betterstack.com/api/v1/heartbeat/WhWrV1nQ1id5jNDrAtRsgBnG'
};

function pingHeartbeat(type) {
  // 1. Better Uptime
  const betterUptimeUrl = BETTER_UPTIME_HEARTBEATS[type];
  if (betterUptimeUrl) {
    axios.get(betterUptimeUrl).catch(err => console.warn(`[Heartbeat] Failed to ping Better Uptime for ${type}:`, err.message));
  }

  // 2. Statuspage API
  const componentId = STATUSPAGE_COMPONENTS[type];
  const pageId = process.env.STATUSPAGE_PAGE_ID;
  const apiKey = process.env.STATUSPAGE_API_KEY;

  if (pageId && apiKey && componentId) {
    const url = `https://api.statuspage.io/v1/pages/${pageId}/components/${componentId}`;

    axios.patch(url, {
      component: { status: 'operational' }
    }, {
      headers: {
        'Authorization': `OAuth ${apiKey}`,
        'Content-Type': 'application/json'
      }
    }).catch(err => console.warn(`[Statuspage] Failed to update ${type}:`, err.response?.data || err.message));
  }
}

async function sendBrandedEmail(to, subject, title, message, color = '#3b82f6', userId) {
  const emailsEnabled = !['0', 'false', 'no', 'off'].includes(
    String(process.env.USER_EMAILS_ENABLED ?? 'true').trim().toLowerCase()
  );
  if (!emailsEnabled) {
    console.log(`[Bot Daemon] User emails disabled — skipped "${subject}" to ${to}`);
    return;
  }

  try {
    const {
      resolveAntiPhishingCodeForEmail,
      injectAntiPhishingIntoHtml,
      renderAntiPhishingPlainText,
    } = require('./lib/anti-phishing');

    const [host, port, user, pass, from] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_HOST' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_PORT' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_USER' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_PASS' } }),
      prisma.systemConfig.findUnique({ where: { key: 'SMTP_FROM' } })
    ]);

    const smtpHost = host?.value || process.env.SMTP_HOST;
    const smtpPort = port?.value || process.env.SMTP_PORT;
    const smtpUser = user?.value || process.env.SMTP_USER;
    const smtpPass = pass?.value || process.env.SMTP_PASS;
    const smtpFrom = from?.value || process.env.SMTP_FROM || '"OpenSteam" <noreply@opensteam.local>';

    if (!smtpHost || !smtpUser || !smtpPass) return;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '587', 10),
      secure: smtpPort === '465',
      auth: { user: smtpUser, pass: smtpPass }
    });

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: sans-serif; background-color: #09090b; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; }
            .header { background-color: ${color}; padding: 30px; text-align: center; color: white; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 40px; color: #a1a1aa; line-height: 1.6; }
            .content h2 { color: white; margin-top: 0; }
            .footer { padding: 20px; text-align: center; border-top: 1px solid #27272a; color: #71717a; font-size: 12px; }
            .btn { display: inline-block; padding: 12px 24px; background-color: ${color}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>OpenSteam Systems</h1></div>
            <div class="content">
              <h2>${title}</h2>
              <p>${message}</p>
              <a href="http://127.0.0.1:3000/dashboard" class="btn">View Dashboard</a>
            </div>
            <div class="footer">&copy; 2026 OpenSteam. All rights reserved.</div>
          </div>
        </body>
      </html>
    `;

    let finalHtml = html;
    let plainTextExtra = '';
    const code = await resolveAntiPhishingCodeForEmail(prisma, to, userId);
    if (code) {
      finalHtml = injectAntiPhishingIntoHtml(finalHtml, code);
      plainTextExtra = renderAntiPhishingPlainText(code);
    }

    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html: finalHtml,
      text: `${title}\n\n${message.replace(/<[^>]+>/g, '')}${plainTextExtra}`,
    });
  } catch (err) {
    console.error('[Daemon SMTP Error]', err.message);
  }
}

// Initial pings
pingHeartbeat('api');
pingHeartbeat('database');
logToBetterStack('OpenSteam Bot Daemon initialized and sending initial health pings.', 'INFO');

// Ping every 45 seconds
setInterval(() => {
  pingHeartbeat('api');
  pingHeartbeat('database');
  logToBetterStack('OpenSteam Bot Daemon background health cycle completed.', 'INFO');
}, 45 * 1000);

// Send Telegram channel promo at random intervals between 5 and 20 minutes
async function sendTelegramPromo() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
  if (!token || !channelId) return;

  try {
    const activePromos = await prisma.telegramPromoMessage.findMany({ where: { isActive: true } });
    if (!activePromos.length) return;

    const promo = activePromos[Math.floor(Math.random() * activePromos.length)];
    const endpoint = promo.photo
      ? `https://api.telegram.org/bot${token}/sendPhoto`
      : `https://api.telegram.org/bot${token}/sendMessage`;

    const body = promo.photo
      ? { chat_id: channelId, photo: promo.photo, caption: promo.text, parse_mode: 'HTML' }
      : { chat_id: channelId, text: promo.text, parse_mode: 'HTML' };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      console.log(`[Telegram Promo] ✅ Sent promo to ${channelId}`);
    } else {
      const err = await res.text();
      console.error(`[Telegram Promo] ❌ Failed: ${err}`);
    }
  } catch (err) {
    console.error('[Telegram Promo] Error:', err.message);
  }
}

function scheduleNextTelegramPromo() {
  // Random delay between 5 and 20 minutes
  const minMs = 5 * 60 * 1000;
  const maxMs = 20 * 60 * 1000;
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  
  console.log(`[Telegram Promo] Next promo scheduled in ${Math.round(delay / 60000)} minutes.`);
  setTimeout(async () => {
    await sendTelegramPromo();
    scheduleNextTelegramPromo();
  }, delay);
}

scheduleNextTelegramPromo();

/**
 * 1. Load DATABASE_URL for Prisma from .env if needed
 */
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const parsed = {};

  // First pass: collect raw values
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = (match[2] || '').trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      parsed[match[1]] = value;
    }
  });

  // Second pass: expand ${VAR} references using parsed keys + existing process.env
  const expand = (val) =>
    val.replace(/\$\{([^}]+)\}/g, (_, name) =>
      parsed[name] !== undefined ? parsed[name] : (process.env[name] || '')
    );

  Object.entries(parsed).forEach(([key, raw]) => {
    process.env[key] = expand(raw);
  });
}

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/\?.*$/, '') + '?connection_limit=3&pool_timeout=20'
    : undefined,
});
const steamCache = new Map();

async function sendUserDirectMessage(discordUser, payload, userId) {
  const { enrichDiscordDmPayload } = require('./lib/anti-phishing');
  const normalizedPayload = typeof payload === 'string' ? { content: payload } : payload;
  const enriched = await enrichDiscordDmPayload(prisma, discordUser.id, normalizedPayload, userId);
  return discordUser.send(enriched);
}

// `users.coins` is a Postgres int4 column (max 2,147,483,647). Atomic
// `{ increment }` updates throw "integer out of range" (22003) once a balance
// would exceed that ceiling, which crashes the daemon. This clamps the new
// balance atomically in SQL (casting to bigint first so the intermediate sum
// can't overflow), and returns the PrismaPromise so it also works inside
// prisma.$transaction([...]).
const MAX_COINS = 2147483647;
function incrementCoinsSafe(userId, amount, client = prisma) {
  const delta = Math.trunc(Number(amount) || 0);
  return client.$executeRaw`UPDATE "users" SET coins = GREATEST(LEAST(coins::bigint + ${delta}::bigint, ${MAX_COINS}::bigint), 0)::int WHERE id = ${userId}`;
}

/**
 * Helper to fetch Steam Info with basic memory caching.
 * Retries with exponential backoff because store.steampowered.com is
 * heavily rate-limited and returns 429s / partial data under load.
 * Uses cc=us — the request-IP-default region returns success:false for
 * many otherwise-available games (regional pricing etc).
 */
async function getCachedSteamInfo(appId) {
  if (steamCache.has(appId)) {
    const entry = steamCache.get(appId);
    if (Date.now() - entry.timestamp < 1000 * 60 * 60) { // 1 hour cache
      return entry.data;
    }
  }

  const STEAM_RETRY_DELAYS_MS = [0, 800, 2200]; // ~3 attempts in <4s
  for (let attempt = 0; attempt < STEAM_RETRY_DELAYS_MS.length; attempt++) {
    if (STEAM_RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, STEAM_RETRY_DELAYS_MS[attempt]));
    }
    try {
      const res = await axios.get(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic&l=english&cc=us`,
        { timeout: 8000, validateStatus: () => true }
      );
      if (res.status === 429) {
        console.warn(`[Steam Cache] 429 for ${appId}, attempt ${attempt + 1}`);
        continue; // backoff + retry
      }
      if (res.status < 200 || res.status >= 300) {
        console.warn(`[Steam Cache] HTTP ${res.status} for ${appId}`);
        break;
      }
      const node = res.data?.[appId];
      if (!node) break;
      if (node.success === false) break; // Steam genuinely doesn't know it
      if (node.data) {
        steamCache.set(appId, { data: node.data, timestamp: Date.now() });
        return node.data;
      }
      break;
    } catch (e) {
      console.warn(`[Steam Cache] attempt ${attempt + 1} failed for ${appId}:`, e.message);
    }
  }
  return null;
}

/**
 * True when a manifest name is one of the legacy placeholders
 * ("Manifest 730" / "App 730") rather than a real game name.
 */
function isPlaceholderName(name) {
  return !name || /^(Manifest|App)\s+\d+$/i.test(name);
}

/**
 * Build a safe Discord attachment filename — avoids the doubled-appId
 * "App_2483190_2483190.zip" output when the name itself ends with the appId.
 */
function safeManifestFilename(name, appId) {
  const cleaned = (name || '').replace(/[^a-zA-Z0-9]/g, '_');
  const appIdStr = String(appId);
  if (!cleaned || cleaned === `App_${appIdStr}` || cleaned === `Manifest_${appIdStr}`) {
    return `App_${appIdStr}.zip`;
  }
  return `${cleaned}_${appIdStr}.zip`;
}

function safeLuaFilename(name, appId) {
  const cleaned = (name || '').replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  const appIdStr = String(appId);
  return `${cleaned || `App_${appIdStr}`}_DLC_${appIdStr}.lua`;
}

const MAX_GEN_DISCORD_ZIP = 25 * 1024 * 1024;
const MAX_GEN_DISCORD_ZIP_LABEL = '25MB';

/** Set in startBot(); used by /gen storage helpers. */
let botS3Client = null;
let autogenRunning = false;
let depotBoxAutogenTickRunning = false;
let upstreamAutogenTickRunning = false;

function getGenAppUrl() {
  try {
    const { readPublicTunnelUrl } = require('./lib/public-tunnel-url');
    const tunnel = readPublicTunnelUrl();
    if (tunnel) return tunnel.replace(/\/$/, '');
  } catch (_) {}
  try {
    const { readSiteSettings } = require('./lib/site-settings');
    const settings = readSiteSettings();
    const url = settings.loginUrl || settings.siteUrl;
    if (url && !url.includes('opensteam.lol')) return url.replace(/\/$/, '');
    if (url) return url.replace(/\/$/, '');
  } catch (_) {}
  const fromEnv = process.env.PUBLIC_TUNNEL_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://opensteam.lol';
}

function getSiteHostLabel() {
  try {
    return new URL(getGenAppUrl()).host;
  } catch (_) {
    return 'opensteam.lol';
  }
}

/** Must complete Discord verification before using generation commands. */
function isWebLinked(user) {
  return !!(user && user.discordVerifiedAt);
}

function accountNotLinkedReply(interaction) {
  const {
    accountNotVerifiedReply,
  } = require('./lib/gen-access-gate');
  return accountNotVerifiedReply(interaction, getGenAppUrl());
}

async function assertGenCommandAccess(interaction, user) {
  const { assertGenerationAccess } = require('./lib/gen-access-gate');
  const verifyCfg = await getVerifyConfig();
  const gate = await assertGenerationAccess(prisma, user, {
    interaction,
    verifiedRoleId: verifyCfg.verifiedRoleId,
  });
  if (gate.ok) return null;
  if (gate.code === 'BANNED') {
    return interaction.reply({
      content: '❌ **Account Banned**: Your account is permanently suspended from using OpenSteam services.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (gate.code === 'ALT_NETWORK') {
    return interaction.reply({ content: `❌ ${gate.message}`, flags: MessageFlags.Ephemeral });
  }
  return accountNotLinkedReply(interaction);
}

const VERIFY_DEFAULTS = {
  UNVERIFIED_ROLE_ID: '1532919070473584840',
  VERIFIED_ROLE_ID: '1532912441954926603',
  VERIFY_CHANNEL_ID: '1532910591264423988',
  VERIFY_BANNER_URL: 'https://manifest-web-ylio.onrender.com/opensteam.png',
};

async function getVerifyConfig() {
  const keys = [
    'DISCORD_VERIFY_ENABLED',
    'DISCORD_UNVERIFIED_ROLE_ID',
    'DISCORD_VERIFIED_ROLE_ID',
    'DISCORD_VERIFY_CHANNEL_ID',
    'DISCORD_VERIFY_BANNER_URL',
    'DISCORD_VERIFY_MESSAGE_ID',
    'DISCORD_BACKUP_VERIFY_MESSAGE_ID',
    'DISCORD_GUILD_ID',
  ];
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: keys } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const guildBot = await resolveGuildBotToken();
  const verifyMessageId =
    guildBot.source === 'backup' && map.DISCORD_BACKUP_VERIFY_MESSAGE_ID
      ? map.DISCORD_BACKUP_VERIFY_MESSAGE_ID
      : map.DISCORD_VERIFY_MESSAGE_ID || null;
  return {
    enabled: map.DISCORD_VERIFY_ENABLED !== 'false',
    unverifiedRoleId: map.DISCORD_UNVERIFIED_ROLE_ID || VERIFY_DEFAULTS.UNVERIFIED_ROLE_ID,
    verifiedRoleId: map.DISCORD_VERIFIED_ROLE_ID || VERIFY_DEFAULTS.VERIFIED_ROLE_ID,
    verifyChannelId: map.DISCORD_VERIFY_CHANNEL_ID || VERIFY_DEFAULTS.VERIFY_CHANNEL_ID,
    verifyBannerUrl: map.DISCORD_VERIFY_BANNER_URL || VERIFY_DEFAULTS.VERIFY_BANNER_URL,
    verifyMessageId,
    verifyMessageKey:
      guildBot.source === 'backup' ? 'DISCORD_BACKUP_VERIFY_MESSAGE_ID' : 'DISCORD_VERIFY_MESSAGE_ID',
    botSource: guildBot.source,
    guildId: map.DISCORD_GUILD_ID || null,
    botToken: guildBot.token,
  };
}

async function saveVerifyMessageId(messageId, key = 'DISCORD_VERIFY_MESSAGE_ID') {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: messageId },
    create: { key, value: messageId, isSecret: false },
  });
}

/** True when the user left the guild and must re-verify to refresh stored account data. */
async function memberNeedsVerificationRenewal(discordId) {
  try {
    const dbUser = await prisma.user.findUnique({
      where: { discordId },
      select: { webSessionRevokedAt: true },
    });
    return Boolean(dbUser?.webSessionRevokedAt);
  } catch (err) {
    console.warn('[Verify] Failed to check renewal status:', err.message);
    return false;
  }
}

async function resetMemberForVerificationRenewal(member, verifyCfg, reason) {
  if (member.roles.cache.has(verifyCfg.verifiedRoleId)) {
    await member.roles.remove(verifyCfg.verifiedRoleId, reason).catch((e) => {
      console.warn('[Verify] Failed to remove verified role for renewal:', e.message);
    });
  }
  if (!member.roles.cache.has(verifyCfg.unverifiedRoleId)) {
    await member.roles.add(verifyCfg.unverifiedRoleId, reason).catch((e) => {
      console.warn('[Verify] Failed to add unverified role for renewal:', e.message);
    });
  }
}

async function sendGuildJoinWelcomeDm(member, isRejoin) {
  const active = await resolveActiveBotToken();
  const secret = active.token;
  if (!secret) {
    console.warn('[GuildJoinWelcome] No active Discord bot token configured');
    return;
  }

  const appUrl = uploadServerUrl();
  const username = member.user.globalName || member.user.username || member.user.tag;
  const res = await fetch(`${appUrl}/api/admin/bot/guild-join-welcome`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      discordId: member.id,
      username,
      isRejoin: Boolean(isRejoin),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.warn('[GuildJoinWelcome] API error:', res.status, data.error || data);
  }
}

async function ensureVerifyMessage(client) {
  try {
    const cfg = await getVerifyConfig();
    if (!cfg.enabled) return;

    const channel = await client.channels.fetch(cfg.verifyChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn('[Verify] Verify channel not found:', cfg.verifyChannelId);
      return;
    }

    if (cfg.verifyMessageId) {
      const existing = await channel.messages.fetch(cfg.verifyMessageId).catch(() => null);
      if (existing) {
        console.log('[Verify] Verify message already present:', cfg.verifyMessageId);
        return;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('OpenSteam Manifests Verification')
      .setDescription('To gain access to OpenSteam Manifests you need to prove you are a human by completing verification. Click the button below to get started!')
      .setImage(cfg.verifyBannerUrl);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify:start')
        .setLabel('Verify')
        .setStyle(ButtonStyle.Success)
    );

    const sent = await channel.send({ embeds: [embed], components: [row] });
    await saveVerifyMessageId(sent.id, cfg.verifyMessageKey || 'DISCORD_VERIFY_MESSAGE_ID');
    console.log('[Verify] Posted verify message:', sent.id);
  } catch (err) {
    console.error('[Verify] ensureVerifyMessage error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTNERSHIP PANEL
// ─────────────────────────────────────────────────────────────────────────────
const PARTNERSHIP_PANEL_CHANNEL_ID = '1444925937849471016';
const PARTNERSHIP_AD_CHANNEL_ID    = '1474855101557637222';
const PARTNERSHIP_PANEL_MSG_KEY    = 'DISCORD_PARTNERSHIP_PANEL_MESSAGE_ID';

/** In-memory store: ticketChannelId -> { applicantId, ad, invite, members } */
const activePartnershipTickets = new Map();

async function ensurePartnershipPanel(client) {
  try {
    const channel = await client.channels.fetch(PARTNERSHIP_PANEL_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn('[Partnership] Panel channel not found:', PARTNERSHIP_PANEL_CHANNEL_ID);
      return;
    }

    // Check if we already have a saved message ID
    const saved = await prisma.systemConfig.findUnique({ where: { key: PARTNERSHIP_PANEL_MSG_KEY } });
    if (saved?.value) {
      const existing = await channel.messages.fetch(saved.value).catch(() => null);
      if (existing) {
        console.log('[Partnership] Panel message already present:', saved.value);
        return;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤝 Partnership Applications')
      .setDescription(
        'Interested in partnering with us? Click the button below to submit your partnership application.\n\n'
        + '**Requirements:**\n'
        + '• Your server must have an active community\n'
        + '• Include a full server advertisement\n'
        + '• Provide a valid Discord invite link\n'
        + '• Share your current member count\n\n'
        + '_Our staff team will review your application and get back to you shortly._'
      )
      .setFooter({ text: 'OpenSteam Partnerships' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('partnership:open')
        .setLabel('📋 Apply for Partnership')
        .setStyle(ButtonStyle.Primary)
    );

    const sent = await channel.send({ embeds: [embed], components: [row] });
    await prisma.systemConfig.upsert({
      where:  { key: PARTNERSHIP_PANEL_MSG_KEY },
      update: { value: sent.id },
      create: { key: PARTNERSHIP_PANEL_MSG_KEY, value: sent.id, isSecret: false },
    });
    console.log('[Partnership] Panel message posted:', sent.id);
  } catch (err) {
    console.error('[Partnership] ensurePartnershipPanel error:', err.message);
  }
}

/** Embed fields for the public /gen summary (ZIP is never attached here). */
function buildGenDeliveryFields({ gameName, appId, zipDelivered, zipTooLarge, zipVia }) {
  const appUrl = getGenAppUrl();
  const fields = [];

  if (zipDelivered) {
    const where = zipVia === 'dm' ? 'your DMs' : 'a private reply below';
    fields.push({
      name: 'ZIP file',
      value: `Sent in ${where} — **only you** can see it.`,
      inline: false,
    });
  } else if (zipTooLarge) {
    fields.push({
      name: 'ZIP file',
      value: `Too large for Discord (over ${MAX_GEN_DISCORD_ZIP_LABEL}). Sign in at [${getSiteHostLabel()}](${appUrl}) — saved on our servers.`,
      inline: false,
    });
  }

  fields.push({
    name: 'Web download',
    value: `Sign in with Discord at [${getSiteHostLabel()}](${appUrl}) to download **${gameName}** (\`${appId}\`) from the site.`,
    inline: false,
  });

  return fields;
}

/** Save ZIP to S3 or local volume (same layout as the web app). */
async function persistGenManifestZip(appId, zipBuffer) {
  const appIdStr = String(appId);
  const filename = `${appIdStr}.zip`;
  const s3Key = `manifests/${appIdStr}/${filename}`;

  if (botS3Client && process.env.AWS_S3_BUCKET_NAME) {
    try {
      await botS3Client.send(new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
        Body: zipBuffer,
        ContentType: 'application/zip',
      }));
      return { storageType: 's3', s3Key };
    } catch (e) {
      console.warn('[Bot Gen] S3 persist failed, falling back to local:', e.message);
    }
  }

  const storagePath = process.env.STORAGE_PATH || path.join(__dirname, '../data');
  const dir = path.join(storagePath, 'manifests', appIdStr);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), zipBuffer);
  return { storageType: 'local', s3Key: null };
}

/** Upsert manifest row + storage so signed-in web/API download works after /gen. */
async function upsertGenManifestRecord(appId, gameName, zipBuffer, userId) {
  const { storageType, s3Key } = await persistGenManifestZip(appId, zipBuffer);
  const name = (gameName || `App ${appId}`).slice(0, 200);

  await prisma.manifest.upsert({
    where: { steamAppId: String(appId) },
    update: {
      name,
      fileSize: BigInt(zipBuffer.length),
      storageType,
      ...(s3Key ? { s3Key } : {}),
      updatedAt: new Date(),
    },
    create: {
      steamAppId: String(appId),
      name,
      fileSize: BigInt(zipBuffer.length),
      userId,
      storageType,
      s3Key: s3Key || undefined,
      tags: [],
    },
  });
}

/** Load cached manifest ZIP from S3 or local storage (for Discord attachment). */
async function loadCachedManifestZip(appId, knownSizeBytes = null, s3KeyOverride = null) {
  const s3Key = s3KeyOverride || `manifests/${appId}/${appId}.zip`;
  let sizeBytes = knownSizeBytes != null ? Number(knownSizeBytes) : null;

  if (sizeBytes == null && botS3Client && process.env.AWS_S3_BUCKET_NAME) {
    try {
      const head = await botS3Client.send(new HeadObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
      }));
      sizeBytes = Number(head.ContentLength || 0);
    } catch (e) {
      console.warn(`[Bot Gen] S3 HeadObject failed for ${appId}:`, e.message);
    }
  }

  const storagePath = process.env.STORAGE_PATH || path.join(__dirname, '../data');
  const localZipPath = path.join(storagePath, 'manifests', appId, `${appId}.zip`);
  if ((sizeBytes == null || sizeBytes <= 0) && fs.existsSync(localZipPath)) {
    sizeBytes = fs.statSync(localZipPath).size;
  }

  if (!sizeBytes || sizeBytes <= 0) {
    return { buffer: null, reason: 'missing', size: 0 };
  }

  if (sizeBytes > MAX_GEN_DISCORD_ZIP) {
    return { buffer: null, reason: 'too_large', size: sizeBytes };
  }

  if (fs.existsSync(localZipPath)) {
    const stats = fs.statSync(localZipPath);
    if (stats.size > 0 && stats.size <= MAX_GEN_DISCORD_ZIP) {
      return { buffer: fs.readFileSync(localZipPath), reason: null, size: stats.size };
    }
  }

  if (botS3Client && process.env.AWS_S3_BUCKET_NAME) {
    try {
      const s3Res = await botS3Client.send(new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
      }));
      const chunks = [];
      for await (const chunk of s3Res.Body) {
        chunks.push(chunk);
      }
      const zipBuffer = Buffer.concat(chunks);
      if (zipBuffer.length > 0 && zipBuffer.length <= MAX_GEN_DISCORD_ZIP) {
        return { buffer: zipBuffer, reason: null, size: zipBuffer.length };
      }
      if (zipBuffer.length > MAX_GEN_DISCORD_ZIP) {
        return { buffer: null, reason: 'too_large', size: zipBuffer.length };
      }
    } catch (e) {
      console.warn(`[Bot Gen] S3 GetObject failed for ${appId}:`, e.message);
      return { buffer: null, reason: 'load_error', size: sizeBytes, error: e.message };
    }
  }

  return { buffer: null, reason: 'load_error', size: sizeBytes };
}

/**
 * Send ZIP in its own message — only the user who ran /gen can see it.
 * Uses ephemeral follow-up in-channel; falls back to DM if that fails.
 */
async function sendGenZipToRequester(interaction, { gameName, appId, zipBuffer, sourceLabel }) {
  if (!zipBuffer || zipBuffer.length > MAX_GEN_DISCORD_ZIP) {
    return { sent: false, reason: 'too_large' };
  }

  const attachment = new AttachmentBuilder(zipBuffer, {
    name: safeManifestFilename(gameName, appId),
  });

  const zipPayload = {
    content: `🎁 **Your manifest:** ${gameName} (\`${appId}\`)\n_Only you can see this — sourced from \`${sourceLabel}\`._`,
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  };

  try {
    // Must run after editReply so this is a separate message, not the public embed.
    await interaction.followUp(zipPayload);
    return { sent: true, via: 'ephemeral' };
  } catch (e) {
    console.warn('[Bot Gen] Ephemeral ZIP followUp failed, trying DM:', e.message);
    try {
      await sendUserDirectMessage(interaction.user, {
        content: `🎁 **Your OpenSteam manifest:** ${gameName} (\`${appId}\`)\n_Sourced from \`${sourceLabel}\`._`,
        files: [attachment],
      });
      return { sent: true, via: 'dm' };
    } catch (dmErr) {
      console.warn('[Bot Gen] DM ZIP delivery failed:', dmErr.message);
      return { sent: false, reason: dmErr.message };
    }
  }
}

async function notifyGenZipFailure(interaction, message) {
  await interaction.followUp({
    content: message,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function fetchDlcLuaFromHubcap(appId) {
  const apiKey = await getBotConfigValue('MORRENUS_API_KEY');
  if (!apiKey) {
    return { success: false, error: 'MORRENUS_API_KEY is not configured.' };
  }

  const appIdParam = encodeURIComponent(String(appId));
  const requests = [
    {
      url: `https://hubcapmanifest.com/api/v1/lua/dlc/${appIdParam}`,
      headers: { 'X-API-Key': apiKey, Authorization: `Bearer ${apiKey}` },
    },
    {
      url: `https://hubcapmanifest.com/api/v1/lua/dlc/${appIdParam}?api_key=${encodeURIComponent(apiKey)}`,
      headers: {},
    },
  ];

  for (const req of requests) {
    try {
      const res = await axios.get(req.url, {
        responseType: 'arraybuffer',
        timeout: 45_000,
        validateStatus: () => true,
        headers: {
          Accept: 'text/plain, application/octet-stream, */*',
          'User-Agent': 'OpenSteam/1.0',
          ...req.headers,
        },
      });

      const buffer = Buffer.from(res.data || []);
      const preview = buffer.slice(0, 300).toString('utf8').trim().toLowerCase();

      if (res.status >= 200 && res.status < 300 && buffer.length > 0) {
        if (preview.startsWith('<!doctype') || preview.startsWith('<html') || preview.includes('"error"') || preview.includes('"message"')) {
          continue;
        }
        return { success: true, luaBuffer: buffer, source: 'HUBCAP_DLC' };
      }
    } catch (e) {
      // Try the fallback auth style.
    }
  }

  return { success: false, error: 'DLC Lua not found on Hubcap.' };
}

async function sendDlcLuaToRequester(interaction, { gameName, appId, luaBuffer, sourceLabel }) {
  if (!luaBuffer || luaBuffer.length === 0) {
    return { sent: false, reason: 'empty_lua' };
  }
  if (luaBuffer.length > MAX_GEN_DISCORD_ZIP) {
    return { sent: false, reason: 'too_large' };
  }

  const attachment = new AttachmentBuilder(luaBuffer, {
    name: safeLuaFilename(gameName, appId),
  });

  const payload = {
    content: `DLC Lua for **${gameName}** (\`${appId}\`)\n_Sourced from \`${sourceLabel}\`._`,
    files: [attachment],
    flags: MessageFlags.Ephemeral,
  };

  try {
    await interaction.followUp(payload);
    return { sent: true, via: 'ephemeral' };
  } catch (e) {
    console.warn('[DLC Gen] Ephemeral Lua followUp failed, trying DM:', e.message);
    try {
      await sendUserDirectMessage(interaction.user, {
        content: `DLC Lua for **${gameName}** (\`${appId}\`)\n_Sourced from \`${sourceLabel}\`._`,
        files: [attachment],
      });
      return { sent: true, via: 'dm' };
    } catch (dmErr) {
      console.warn('[DLC Gen] DM Lua delivery failed:', dmErr.message);
      return { sent: false, reason: dmErr.message };
    }
  }
}

/**
 * Passive backfill: when /gen successfully resolves a real Steam name and
 * the manifest row in the DB still has a placeholder, update it.
 */
async function passiveBackfillManifestName(appId, realName) {
  try {
    if (!realName || isPlaceholderName(realName)) return;
    const row = await prisma.manifest.findUnique({ where: { steamAppId: String(appId) }, select: { id: true, name: true } });
    if (!row) return;
    if (!isPlaceholderName(row.name)) return; // already has a real name
    await prisma.manifest.update({ where: { id: row.id }, data: { name: realName.slice(0, 200) } });
    console.log(`[Passive Backfill] ${appId}: "${row.name}" -> "${realName}"`);
  } catch (e) {
    console.warn(`[Passive Backfill] failed for ${appId}:`, e.message);
  }
}

function normalizeRequestAppId(value) {
  const appId = String(value || '').trim();
  return /^\d+$/.test(appId) ? appId : null;
}

async function resolveAutogenRequestAppId(request) {
  const existingAppId = normalizeRequestAppId(request.appId);
  if (existingAppId) return { appId: existingAppId, name: request.name };

  const { normalizeSteamName } = require('./lib/steam-app-list');
  const targetName = normalizeSteamName(request.name);
  if (!targetName || targetName.length < 3) {
    return { appId: null, name: request.name, reason: 'missing App ID and game name is too short to resolve' };
  }

  const resolved = await resolveAutogenAppIdFromName(request.name, getBotConfigValue);
  if (!resolved) {
    return { appId: null, name: request.name, reason: 'could not resolve App ID from request name' };
  }

  const { appId, name } = resolved;

  await prisma.gameRequest.update({
    where: { id: request.id },
    data: { appId, name },
  }).catch((e) => console.warn(`[Autogen] Failed to persist resolved App ID for request ${request.id}:`, e.message));

  return { appId, name };
}

async function updateAutogenRequestMessage(client, request, gameName, appId, options = {}) {
  if (!request.discordChannelId || !request.discordMessageId) return;

  try {
    const channel = await client.channels.fetch(request.discordChannelId).catch(() => null);
    if (!channel || !channel.messages) return;

    const message = await channel.messages.fetch(request.discordMessageId).catch(() => null);
    if (!message) return;

    const gameInfo = await getCachedSteamInfo(appId);
    const embed = buildAutogenFulfilledEmbed({
      request,
      gameName: gameInfo?.name || gameName,
      appId,
      gameInfo,
      detail: options.detail,
      source: options.source,
    });

    await message.edit({
      content: request.user?.discordId
        ? `🔔 <@${request.user.discordId}>, **${gameInfo?.name || gameName}** has been indexed via autogen.`
        : `🔔 **${gameInfo?.name || gameName}** has been indexed via autogen.`,
      embeds: [embed],
    });
  } catch (e) {
    console.warn('[Autogen] Failed to update Discord request message:', e.message);
  }
}

async function fulfillPendingRequestsForApp(client, appId, gameName, options = {}) {
  const pendingRequests = await prisma.gameRequest.findMany({
    where: { appId: String(appId), status: 'PENDING' },
    include: { user: true },
  });

  if (pendingRequests.length === 0) return 0;

  await prisma.gameRequest.updateMany({
    where: { id: { in: pendingRequests.map((request) => request.id) } },
    data: { status: 'FULFILLED', name: gameName },
  });

  for (const request of pendingRequests) {
    await updateAutogenRequestMessage(
      client,
      { ...request, status: 'FULFILLED', name: gameName },
      gameName,
      appId,
      options,
    );
  }

  return pendingRequests.length;
}

let proxyCache = [];
let proxyCacheTime = 0;

async function fetchProxiflyProxy() {
  if (Date.now() - proxyCacheTime > 60 * 60 * 1000 || proxyCache.length === 0) {
    try {
      const res = await axios.get('https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt', { timeout: 10000 });
      proxyCache = res.data.split('\n').map(line => line.trim()).filter(line => line.includes(':'));
      proxyCacheTime = Date.now();
    } catch (e) {
      console.warn('[Heavygen] Failed to fetch proxy list', e.message);
    }
  }
  
  if (proxyCache.length === 0) return null;
  const randomProxy = proxyCache[Math.floor(Math.random() * proxyCache.length)];
  const [host, port] = randomProxy.split(':');
  
  const { HttpsProxyAgent } = require('https-proxy-agent');
  return new HttpsProxyAgent(`http://${host}:${port}`);
}

async function collectHeavygenBatch(limit) {
  const [apps, manifests, cursorRaw] = await Promise.all([
    fetchSteamAppList(getBotConfigValue),
    prisma.manifest.findMany({ select: { steamAppId: true } }),
    getBotConfigValue('AUTOGEN_HEAVYGEN_CURSOR', false),
  ]);

  const present = new Set(manifests.map(m => String(m.steamAppId)));
  const parsedCursor = Number.parseInt(cursorRaw || '0', 10);
  const cursor = Number.isFinite(parsedCursor) && apps.length > 0 ? Math.max(0, parsedCursor) % apps.length : 0;
  
  const batch = [];
  let scanned = 0;
  let nextCursor = cursor;

  while (apps.length > 0 && scanned < apps.length && batch.length < limit) {
    const index = (cursor + scanned) % apps.length;
    const app = apps[index];
    nextCursor = (index + 1) % apps.length;
    scanned += 1;

    const appId = String(app?.appid || '').trim();
    if (!appId || present.has(appId)) continue;
    
    batch.push({ appId, name: app.name, index });
  }

  return { batch, nextCursor, appCount: apps.length };
}

async function runHeavygenBatch(batch, client) {
  const results = [];
  for (const candidate of batch) {
    const agent = await fetchProxiflyProxy();
    const axiosOpts = {
      timeout: 10000,
      responseType: 'arraybuffer',
      ...(agent && { httpsAgent: agent })
    };
    
    let foundUrl = null;
    let response = null;
    
    const checkUrls = [
      `https://raw.githubusercontent.com/BlissBlender/Charon-Database/main/database-1/App_${candidate.appId}.zip`,
      `https://raw.githubusercontent.com/BlissBlender/Charon-Database/main/database-2/App_${candidate.appId}.zip`,
      `https://raw.githubusercontent.com/BlissBlender/Charon-Database/main/database-1/${candidate.appId}.zip`,
      `https://raw.githubusercontent.com/BlissBlender/Charon-Database/main/database-2/${candidate.appId}.zip`
    ];

    for (const url of checkUrls) {
      try {
        response = await axios.get(url, axiosOpts);
        foundUrl = url;
        break;
      } catch (e) {
        // Continue to next
      }
    }

    if (foundUrl && response && response.data) {
      const registerResult = await registerAutogenManifestLocally(client, {
        appId: candidate.appId,
        gameName: candidate.name,
        zipBuffer: Buffer.from(response.data),
      });

      if (registerResult.ok) {
        results.push({ appId: candidate.appId, name: candidate.name, status: 'added', detail: 'Heavygen mirror via proxy' });
      } else {
        results.push({ appId: candidate.appId, name: candidate.name, status: 'failed', detail: registerResult.error });
      }
    } else {
      results.push({ appId: candidate.appId, name: candidate.name, status: 'failed', detail: 'Not found in mirror' });
    }
  }
  return results;
}

let heavygenTickRunning = false;

async function syncHeavygenDayState() {
  const dailyLimitRaw = await getBotConfigValue('AUTOGEN_HEAVYGEN_DAILY_LIMIT', false);
  const dailyLimit = Number.parseInt(dailyLimitRaw || '1440', 10);
  
  const todayCountRaw = await getBotConfigValue('AUTOGEN_HEAVYGEN_DAY_COUNT', false);
  const count = Number.parseInt(todayCountRaw || '0', 10);
  
  return { count: Math.max(0, count), dailyLimit, remaining: Math.max(0, dailyLimit - count) };
}

async function scheduleNextHeavygenTick(dailyLimit) {
  const spreadHours = 24;
  const targetSpacingMs = Math.round((spreadHours * 60 * 60 * 1000) / Math.max(1, dailyLimit));
  const nextRun = new Date(Date.now() + Math.max(10_000, targetSpacingMs));
  await setBotConfigValue('AUTOGEN_HEAVYGEN_NEXT_RUN_AT', nextRun.toISOString());
}

async function isHeavygenEnabled() {
  return parseEnabled(await getBotConfigValue('AUTOGEN_HEAVYGEN_ENABLED', false));
}

async function maybeRunHeavygenTick(client) {
  if (heavygenTickRunning) return;
  if (!(await isHeavygenEnabled())) return;

  const dayState = await syncHeavygenDayState();
  if (dayState.remaining <= 0) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 5, 0, 0);
    await setBotConfigValue('AUTOGEN_HEAVYGEN_NEXT_RUN_AT', tomorrow.toISOString());
    return;
  }

  const nextRunRaw = await getBotConfigValue('AUTOGEN_HEAVYGEN_NEXT_RUN_AT', false);
  const nextRunMs = nextRunRaw ? Date.parse(nextRunRaw) : 0;
  if (!Number.isFinite(nextRunMs) || nextRunMs <= 0) {
    await scheduleNextHeavygenTick(dayState.dailyLimit);
    return;
  }
  if (nextRunMs > Date.now()) return;

  heavygenTickRunning = true;

  try {
    const { batch, nextCursor, appCount } = await collectHeavygenBatch(1);
    
    if (batch.length > 0) {
      const results = await runHeavygenBatch(batch, client);
      
      if (appCount > 0) {
        await setBotConfigValue('AUTOGEN_HEAVYGEN_CURSOR', String(nextCursor));
      }

      const added = results.filter(r => r.status === 'added');
      if (added.length > 0) {
        await setBotConfigValue('AUTOGEN_HEAVYGEN_DAY_COUNT', String(dayState.count + added.length));
        await sendSystemEmbeds(client, formatAutogenSummary(added, 1, 'heavygen'));
      }
    } else {
      if (appCount > 0) {
         await setBotConfigValue('AUTOGEN_HEAVYGEN_CURSOR', String(nextCursor));
      }
    }

    await scheduleNextHeavygenTick(dayState.dailyLimit);
  } catch (e) {
    console.error('[Heavygen] Tick failed:', e);
    await scheduleNextHeavygenTick(dayState.dailyLimit);
  } finally {
    heavygenTickRunning = false;
  }
}

async function uploadAutogenManifestViaRoute({ appId, gameName, zipBuffer }) {
  const apiKey = process.env.ADMIN_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: 'ADMIN_API_KEY is not configured for upload route registration.' };
  }

  const serverUrl = uploadServerUrl();
  if (!serverUrl) {
    return { ok: false, error: 'INTERNAL_APP_URL/NEXT_PUBLIC_APP_URL is not configured for upload route registration.' };
  }

  return postManifestUpload({
    buffer: zipBuffer,
    filename: `${appId}.zip`,
    appId,
    name: gameName,
    serverUrl,
    apiKey,
  });
}

/** Save manifest + DB row in the bot process; post to added-games channel when new. */
async function registerAutogenManifestLocally(client, { appId, gameName, zipBuffer }) {
  const { registerManifestLocally } = require('./lib/register-manifest');
  const result = await registerManifestLocally(prisma, {
    appId,
    gameName,
    zipBuffer,
    s3Client: botS3Client,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || 'register failed', isNew: false };
  }

  if (result.isNew) {
    await announceNewGameAdded(client, { appId, gameName });
  }

  return { ok: true, isNew: result.isNew };
}

async function announceNewGameAdded(client, { appId, gameName }) {
  try {
    const { announceGameAdded, announceGameAddedViaRest } = require('./lib/discord-game-added');
    let name = gameName;
    let imageUrl;
    let shortDescription;
    try {
      const steamInfo = await getCachedSteamInfo(appId);
      if (steamInfo?.name) name = steamInfo.name;
      imageUrl = steamInfo?.header_image;
      shortDescription = steamInfo?.short_description;
    } catch (_) {
      /* optional steam metadata */
    }

    const payload = {
      appId: String(appId),
      gameName: name,
      imageUrl,
      shortDescription,
    };
    const result = client
      ? await announceGameAdded(client, prisma, payload)
      : await announceGameAddedViaRest(prisma, payload);

    if (result.ok) {
      console.log(`[GameAdded] Posted ${appId} (${name}) to added-games channel`);
    } else if (!result.skipped) {
      console.warn('[GameAdded] Post failed:', result.error || result.reason);
    } else {
      console.warn('[GameAdded] Post skipped:', result.reason);
    }
    return result;
  } catch (e) {
    console.warn('[GameAdded] Post error:', e?.message || e);
    return { ok: false, error: e.message };
  }
}

async function autogenRequestedManifest(client, request, operatorUser) {
  const resolved = await resolveAutogenRequestAppId(request);
  const appId = resolved.appId;
  if (!appId) {
    return {
      appId: request.appId || 'N/A',
      name: request.name,
      status: 'skipped',
      detail: resolved.reason || 'missing or invalid App ID',
      fulfilled: 0,
    };
  }

  const gameInfo = await getCachedSteamInfo(appId);
  const gameName = (gameInfo?.name || resolved.name || request.name || `App ${appId}`).slice(0, 200);

  const existingManifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId },
    select: { name: true },
  });

  if (existingManifest) {
    if (gameInfo?.name && isPlaceholderName(existingManifest.name)) {
      void passiveBackfillManifestName(appId, gameInfo.name);
    }
    const fulfilled = await fulfillPendingRequestsForApp(client, appId, gameName, {
      source: 'Existing database entry',
      detail: 'Manifest was already indexed; pending requests were fulfilled.',
    });
    return {
      appId,
      name: gameName,
      status: 'already',
      detail: 'already in database',
      fulfilled,
    };
  }

  const result = await fetchExternalManifest(appId);
  if (!result.success || !result.zipBuffer) {
    return {
      appId,
      name: gameName,
      status: 'not_found',
      detail: result.error || 'not found upstream',
      fulfilled: 0,
    };
  }

  const pendingBeforeUpload = await prisma.gameRequest.count({
    where: { appId: String(appId), status: 'PENDING' },
  });

  const registerResult = await registerAutogenManifestLocally(client, {
    appId,
    gameName,
    zipBuffer: result.zipBuffer,
  });

  if (!registerResult.ok) {
    return {
      appId,
      name: gameName,
      status: 'failed',
      detail: registerResult.error || 'failed to register manifest',
      fulfilled: 0,
    };
  }

  return {
    appId,
    name: gameName,
    status: 'added',
    detail: `${result.source || 'external'} via bot`,
    fulfilled: pendingBeforeUpload,
  };
}

function formatAutogenSummary(results, limit, mode = 'requests') {
  return buildAutogenSummaryEmbeds(results, limit, mode);
}

async function getBotConfigValue(key, envFirst = true) {
  const envVal = process.env[key]?.trim();
  if (envFirst && envVal) return envVal;

  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    const dbVal = row?.value?.trim();
    if (dbVal) return dbVal;
  } catch (e) {
    console.warn(`[Config] Failed to read ${key}:`, e.message);
  }

  return envFirst ? '' : (envVal || '');
}

async function setBotConfigValue(key, value, isSecret = false) {
  return prisma.systemConfig.upsert({
    where: { key },
    update: { value, isSecret },
    create: { key, value, isSecret },
  });
}

function parseEnabled(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase());
}

async function isAutogenEnabled() {
  return parseEnabled(await getBotConfigValue('AUTOGEN_ENABLED', false));
}

function normalizeAutogenMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'depotbox') return 'depotbox';
  if (mode === 'upstream' || mode === 'ryuu' || mode === 'providers') return 'upstream';
  return 'requests';
}

function normalizeAutogenProviderOrder(value) {
  const aliases = {
    hubcap: 'morrenus',
    morenus: 'morrenus',
    morrenus: 'morrenus',
    ryuu: 'ryuu',
    depotbox: 'depotbox',
    depot_box: 'depotbox',
  };
  const parsed = String(value || '')
    .split(',')
    .map((item) => aliases[item.trim().toLowerCase()])
    .filter(Boolean);
  const ordered = [];
  if (parsed.length > 0) {
    for (const provider of parsed) {
      if (!ordered.includes(provider)) ordered.push(provider);
    }
    return ordered;
  }

  return ['ryuu', 'morrenus'];
}

async function getAutogenMode() {
  return normalizeAutogenMode(await getBotConfigValue('AUTOGEN_MODE', false));
}

async function getAutogenProviderOrder() {
  return normalizeAutogenProviderOrder(await getBotConfigValue('AUTOGEN_PROVIDER_ORDER', false));
}

async function getAutogenDailyLimit(mode = 'requests') {
  const normalizedMode = normalizeAutogenMode(mode);
  const raw = normalizedMode === 'depotbox'
    ? await getBotConfigValue('AUTOGEN_DEPOTBOX_DAILY_LIMIT', false)
    : normalizedMode === 'upstream'
      ? await getBotConfigValue('AUTOGEN_UPSTREAM_DAILY_LIMIT', false)
      : await getBotConfigValue('AUTOGEN_DAILY_LIMIT', false);
  const fallback = normalizedMode === 'depotbox' ? 120 : 100;
  const max = normalizedMode === 'depotbox' ? 120 : 100;
  const parsed = Number.parseInt(raw || String(fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

async function getDepotBoxRequestLimitPerMinute() {
  const raw = await getBotConfigValue('DEPOTBOX_REQUESTS_PER_MINUTE', false);
  const parsed = Number.parseInt(raw || '120', 10);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(1, Math.min(120, parsed));
}

async function getDepotBoxSpreadHours() {
  const raw = await getBotConfigValue('AUTOGEN_DEPOTBOX_SPREAD_HOURS', false);
  const parsed = Number.parseFloat(raw || '24');
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(48, parsed));
}

async function computeDepotBoxTickSpacingMs(dailyLimit) {
  const slots = Math.max(1, Math.min(120, dailyLimit));
  const spreadHours = await getDepotBoxSpreadHours();
  return Math.floor((spreadHours * 60 * 60 * 1000) / slots);
}

function depotBoxUtcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function syncDepotBoxDayState() {
  const today = depotBoxUtcDayKey();
  const [dayKey, countRaw, dailyLimit] = await Promise.all([
    getBotConfigValue('AUTOGEN_DEPOTBOX_DAY_KEY', false),
    getBotConfigValue('AUTOGEN_DEPOTBOX_DAY_COUNT', false),
    getAutogenDailyLimit('depotbox'),
  ]);

  let count = Number.parseInt(countRaw || '0', 10);
  if (!Number.isFinite(count) || count < 0) count = 0;

  if (dayKey !== today) {
    count = 0;
    await setBotConfigValue('AUTOGEN_DEPOTBOX_DAY_KEY', today);
    await setBotConfigValue('AUTOGEN_DEPOTBOX_DAY_COUNT', '0');
  }

  return {
    today,
    count,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - count),
  };
}

async function scheduleNextDepotBoxAutogenTick(dailyLimit) {
  const spacing = await computeDepotBoxTickSpacingMs(dailyLimit);
  const jitter = Math.floor(spacing * (0.85 + Math.random() * 0.3));
  await setBotConfigValue(
    'AUTOGEN_DEPOTBOX_NEXT_RUN_AT',
    new Date(Date.now() + Math.max(60_000, jitter)).toISOString(),
  );
}

async function getUpstreamSpreadHours() {
  const raw = await getBotConfigValue('AUTOGEN_UPSTREAM_SPREAD_HOURS', false);
  const parsed = Number.parseFloat(raw || '24');
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(48, parsed));
}

async function computeUpstreamTickSpacingMs(dailyLimit) {
  const slots = Math.max(1, Math.min(100, dailyLimit));
  const spreadHours = await getUpstreamSpreadHours();
  return Math.floor((spreadHours * 60 * 60 * 1000) / slots);
}

async function syncUpstreamDayState() {
  const today = depotBoxUtcDayKey();
  const [dayKey, countRaw, dailyLimit] = await Promise.all([
    getBotConfigValue('AUTOGEN_UPSTREAM_DAY_KEY', false),
    getBotConfigValue('AUTOGEN_UPSTREAM_DAY_COUNT', false),
    getAutogenDailyLimit('upstream'),
  ]);

  let count = Number.parseInt(countRaw || '0', 10);
  if (!Number.isFinite(count) || count < 0) count = 0;

  if (dayKey !== today) {
    count = 0;
    await setBotConfigValue('AUTOGEN_UPSTREAM_DAY_KEY', today);
    await setBotConfigValue('AUTOGEN_UPSTREAM_DAY_COUNT', '0');
  }

  return {
    today,
    count,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - count),
  };
}

async function scheduleNextUpstreamAutogenTick(dailyLimit) {
  const spacing = await computeUpstreamTickSpacingMs(dailyLimit);
  const jitter = Math.floor(spacing * (0.85 + Math.random() * 0.3));
  await setBotConfigValue(
    'AUTOGEN_UPSTREAM_NEXT_RUN_AT',
    new Date(Date.now() + Math.max(60_000, jitter)).toISOString(),
  );
}

async function initializeUpstreamAutogenSchedule({ startDelayMs = 60_000 } = {}) {
  const today = depotBoxUtcDayKey();
  await setBotConfigValue('AUTOGEN_UPSTREAM_DAY_KEY', today);
  await setBotConfigValue('AUTOGEN_UPSTREAM_DAY_COUNT', '0');
  await setBotConfigValue(
    'AUTOGEN_UPSTREAM_NEXT_RUN_AT',
    new Date(Date.now() + Math.max(30_000, startDelayMs)).toISOString(),
  );
}

async function initializeDepotBoxAutogenSchedule({ startDelayMs = 60_000 } = {}) {
  const today = depotBoxUtcDayKey();
  await setBotConfigValue('AUTOGEN_DEPOTBOX_DAY_KEY', today);
  await setBotConfigValue('AUTOGEN_DEPOTBOX_DAY_COUNT', '0');
  await setBotConfigValue(
    'AUTOGEN_DEPOTBOX_NEXT_RUN_AT',
    new Date(Date.now() + Math.max(30_000, startDelayMs)).toISOString(),
  );
}

async function getDepotBoxFetchOptions() {
  return {
    apiKey: await getBotConfigValue('DEPOTBOX_API_KEY'),
    baseUrl: (await getBotConfigValue('DEPOTBOX_API_BASE', false)) || process.env.DEPOTBOX_API_BASE,
    requestsPerMinute: await getDepotBoxRequestLimitPerMinute(),
  };
}

async function hasAutogenProviderKey(mode = 'requests') {
  const normalizedMode = normalizeAutogenMode(mode);
  if (normalizedMode === 'depotbox') {
    return Boolean(await getBotConfigValue('DEPOTBOX_API_KEY'));
  }
  if (normalizedMode === 'upstream') {
    return Boolean(await getBotConfigValue('RYUU_API_KEY')) ||
      Boolean(await getBotConfigValue('MORRENUS_API_KEY'));
  }
  return Boolean(await getBotConfigValue('RYUU_API_KEY')) ||
    Boolean(await getBotConfigValue('MORRENUS_API_KEY')) ||
    Boolean(await getBotConfigValue('DEPOTBOX_API_KEY'));
}

async function resolveAutogenOperatorUser() {
  const configuredDiscordId = (await getBotConfigValue('AUTOGEN_OPERATOR_DISCORD_ID', false)) || process.env.UPLOAD_OPERATOR_DISCORD_ID?.trim();
  if (configuredDiscordId) {
    const configured = await prisma.user.findUnique({ where: { discordId: configuredDiscordId } });
    if (configured) return configured;
  }

  return await prisma.user.findFirst({
    where: { role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  }) || await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
}

async function collectAutogenBatch(limit, requestId = null) {
  const rawRequests = await prisma.gameRequest.findMany({
    where: requestId
      ? { id: requestId, status: 'PENDING' }
      : { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: requestId ? 1 : Math.min(500, Math.max(100, limit * 20)),
    include: { user: true },
  });

  const seenAppIds = new Set();
  const batch = [];

  for (const request of rawRequests) {
    const appId = normalizeRequestAppId(request.appId);
    const key = appId || `request:${request.id}`;
    if (seenAppIds.has(key)) continue;
    seenAppIds.add(key);
    batch.push(request);
    if (batch.length >= limit) break;
  }

  return batch;
}

async function runAutogenBatch(client, operatorUser, { limit = 10, requestId = null, batch: providedBatch = null } = {}) {
  const batch = providedBatch || await collectAutogenBatch(limit, requestId);
  const results = [];

  for (const request of batch) {
    const result = await autogenRequestedManifest(client, request, operatorUser);
    results.push(result);
    if (batch.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return { batch, results };
}

async function collectDepotBoxAutogenBatch(limit) {
  const [apps, manifests, cursorRaw] = await Promise.all([
    fetchSteamAppList(getBotConfigValue),
    prisma.manifest.findMany({ select: { steamAppId: true } }),
    getBotConfigValue('AUTOGEN_DEPOTBOX_CURSOR', false),
  ]);

  const present = new Set(manifests.map((manifest) => String(manifest.steamAppId)));
  const parsedCursor = Number.parseInt(cursorRaw || '0', 10);
  const cursor = Number.isFinite(parsedCursor) && apps.length > 0
    ? Math.max(0, parsedCursor) % apps.length
    : 0;

  const batch = [];
  let scanned = 0;
  let nextCursor = cursor;

  while (apps.length > 0 && scanned < apps.length && batch.length < limit) {
    const index = (cursor + scanned) % apps.length;
    const app = apps[index];
    nextCursor = (index + 1) % apps.length;
    scanned += 1;

    const appId = String(app?.appid || '').trim();
    const name = String(app?.name || '').trim();
    if (!/^\d+$/.test(appId) || !name || present.has(appId)) continue;

    present.add(appId);
    batch.push({ appId, name: name.slice(0, 200), index });
  }

  return { batch, nextCursor, appCount: apps.length };
}

async function autogenDepotBoxManifest(client, candidate) {
  const appId = candidate.appId;
  const gameName = candidate.name || `App ${appId}`;

  const existingManifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId },
    select: { name: true },
  });

  if (existingManifest) {
    return {
      appId,
      name: existingManifest.name || gameName,
      status: 'already',
      detail: 'already in database',
      fulfilled: 0,
    };
  }

  const depotBoxOptions = await getDepotBoxFetchOptions();
  const availability = await checkDepotBoxAvailability(appId, depotBoxOptions);
  if (!availability.available) {
    return {
      appId,
      name: gameName,
      status: 'not_found',
      detail: availability.error || 'not available on DepotBox',
      fulfilled: 0,
    };
  }

  const result = await fetchManifestFromDepotBox(appId, depotBoxOptions);
  if (!result.success || !result.zipBuffer) {
    const detail = result.error || 'not found on DepotBox';
    const notFoundish = /not found|no manifest|failed to prepare/i.test(detail);
    return {
      appId,
      name: gameName,
      status: notFoundish ? 'not_found' : 'failed',
      detail,
      fulfilled: 0,
    };
  }

  const pendingBeforeUpload = await prisma.gameRequest.count({
    where: { appId: String(appId), status: 'PENDING' },
  });

  const registerResult = await registerAutogenManifestLocally(client, {
    appId,
    gameName: result.gameName || gameName,
    zipBuffer: result.zipBuffer,
  });

  if (!registerResult.ok) {
    return {
      appId,
      name: result.gameName || gameName,
      status: 'failed',
      detail: registerResult.error || 'failed to register DepotBox manifest',
      fulfilled: 0,
    };
  }

  return {
    appId,
    name: result.gameName || gameName,
    status: 'added',
    detail: 'DepotBox via bot',
    fulfilled: pendingBeforeUpload,
  };
}

async function runDepotBoxAutogenBatch(client, operatorUser, { limit = 120, manual = false, updateDayCount = false } = {}) {
  const collected = await collectDepotBoxAutogenBatch(limit);
  const results = [];
  const delayMs = manual
    ? Math.min(60_000, await computeDepotBoxTickSpacingMs(await getAutogenDailyLimit('depotbox')))
    : 0;

  for (let index = 0; index < collected.batch.length; index += 1) {
    const candidate = collected.batch[index];
    const result = await autogenDepotBoxManifest(client, candidate);
    results.push(result);
    if (collected.appCount > 0) {
      await setBotConfigValue('AUTOGEN_DEPOTBOX_CURSOR', String((candidate.index + 1) % collected.appCount));
    }
    if (updateDayCount && result.status === 'added') {
      const dayState = await syncDepotBoxDayState();
      await setBotConfigValue('AUTOGEN_DEPOTBOX_DAY_COUNT', String(dayState.count + 1));
    }
    if (index < collected.batch.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (collected.batch.length === 0 && collected.appCount > 0) {
    await setBotConfigValue('AUTOGEN_DEPOTBOX_CURSOR', String(collected.nextCursor));
  }

  return { batch: collected.batch, results };
}

async function collectUpstreamAutogenBatch(limit) {
  const [apps, manifests, cursorRaw] = await Promise.all([
    fetchSteamAppList(getBotConfigValue),
    prisma.manifest.findMany({ select: { steamAppId: true } }),
    getBotConfigValue('AUTOGEN_UPSTREAM_CURSOR', false),
  ]);

  const present = new Set(manifests.map((manifest) => String(manifest.steamAppId)));
  const parsedCursor = Number.parseInt(cursorRaw || '0', 10);
  const cursor = Number.isFinite(parsedCursor) && apps.length > 0
    ? Math.max(0, parsedCursor) % apps.length
    : 0;

  const batch = [];
  let scanned = 0;
  let nextCursor = cursor;

  while (apps.length > 0 && scanned < apps.length && batch.length < limit) {
    const index = (cursor + scanned) % apps.length;
    const app = apps[index];
    nextCursor = (index + 1) % apps.length;
    scanned += 1;

    const appId = String(app?.appid || '').trim();
    const name = String(app?.name || '').trim();
    if (!/^\d+$/.test(appId) || !name || present.has(appId)) continue;

    present.add(appId);
    batch.push({ appId, name: name.slice(0, 200), index });
  }

  return { batch, nextCursor, appCount: apps.length };
}

async function autogenUpstreamManifest(client, candidate) {
  const appId = candidate.appId;
  const gameName = candidate.name || `App ${appId}`;

  const existingManifest = await prisma.manifest.findUnique({
    where: { steamAppId: appId },
    select: { name: true },
  });

  if (existingManifest) {
    return {
      appId,
      name: existingManifest.name || gameName,
      status: 'already',
      detail: 'already in database',
      fulfilled: 0,
    };
  }

  const result = await fetchExternalManifest(appId);
  if (!result.success || !result.zipBuffer) {
    const detail = result.error || 'not found upstream';
    const notFoundish = /not found|missing|404|status 4/i.test(detail);
    return {
      appId,
      name: gameName,
      status: notFoundish ? 'not_found' : 'failed',
      detail,
      fulfilled: 0,
    };
  }

  const pendingBeforeUpload = await prisma.gameRequest.count({
    where: { appId: String(appId), status: 'PENDING' },
  });

  const registerResult = await registerAutogenManifestLocally(client, {
    appId,
    gameName,
    zipBuffer: result.zipBuffer,
  });

  if (!registerResult.ok) {
    return {
      appId,
      name: gameName,
      status: 'failed',
      detail: registerResult.error || 'failed to register manifest',
      fulfilled: 0,
    };
  }

  return {
    appId,
    name: gameName,
    status: 'added',
    detail: `${result.source || 'upstream'} via bot`,
    fulfilled: pendingBeforeUpload,
  };
}

async function runUpstreamAutogenBatch(client, operatorUser, { limit = 100, manual = false, updateDayCount = false } = {}) {
  const collected = await collectUpstreamAutogenBatch(limit);
  const results = [];
  const delayMs = manual
    ? Math.min(60_000, await computeUpstreamTickSpacingMs(await getAutogenDailyLimit('upstream')))
    : 3500;

  for (let index = 0; index < collected.batch.length; index += 1) {
    const candidate = collected.batch[index];
    const result = await autogenUpstreamManifest(client, candidate);
    results.push(result);
    if (collected.appCount > 0) {
      await setBotConfigValue('AUTOGEN_UPSTREAM_CURSOR', String((candidate.index + 1) % collected.appCount));
    }
    if (updateDayCount && result.status === 'added') {
      const dayState = await syncUpstreamDayState();
      await setBotConfigValue('AUTOGEN_UPSTREAM_DAY_COUNT', String(dayState.count + 1));
    }
    if (index < collected.batch.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (collected.batch.length === 0 && collected.appCount > 0) {
    await setBotConfigValue('AUTOGEN_UPSTREAM_CURSOR', String(collected.nextCursor));
  }

  return { batch: collected.batch, results };
}

async function maybeRunUpstreamAutogenTick(client) {
  if (upstreamAutogenTickRunning || autogenRunning || depotBoxAutogenTickRunning) return;
  if (!(await isAutogenEnabled())) return;
  if ((await getAutogenMode()) !== 'upstream') return;

  const dayState = await syncUpstreamDayState();
  if (dayState.remaining <= 0) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 5, 0, 0);
    await setBotConfigValue('AUTOGEN_UPSTREAM_NEXT_RUN_AT', tomorrow.toISOString());
    return;
  }

  const nextRunRaw = await getBotConfigValue('AUTOGEN_UPSTREAM_NEXT_RUN_AT', false);
  const nextRunMs = nextRunRaw ? Date.parse(nextRunRaw) : 0;
  if (!Number.isFinite(nextRunMs) || nextRunMs <= 0) {
    await initializeUpstreamAutogenSchedule({ startDelayMs: 60_000 });
    return;
  }
  if (nextRunMs > Date.now()) return;

  if (!(await hasAutogenProviderKey('upstream'))) {
    await scheduleNextUpstreamAutogenTick(dayState.dailyLimit);
    return;
  }

  upstreamAutogenTickRunning = true;

  try {
    const { results } = await runUpstreamAutogenBatch(client, null, {
      limit: 1,
      updateDayCount: true,
    });

    if (results.length > 0) {
      const notable = results.some((item) => item.status === 'added' || item.status === 'failed');
      if (notable) {
        await sendSystemEmbeds(client, formatAutogenSummary(results, 1, 'upstream'));
      }
    }

    await scheduleNextUpstreamAutogenTick(dayState.dailyLimit);
  } catch (e) {
    console.error('[Autogen] Upstream tick failed:', e);
    await scheduleNextUpstreamAutogenTick(dayState.dailyLimit);
  } finally {
    upstreamAutogenTickRunning = false;
  }
}

async function maybeRunDepotBoxAutogenTick(client) {
  if (depotBoxAutogenTickRunning || autogenRunning || upstreamAutogenTickRunning) return;
  if (!(await isAutogenEnabled())) return;
  if ((await getAutogenMode()) !== 'depotbox') return;

  const dayState = await syncDepotBoxDayState();
  if (dayState.remaining <= 0) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 5, 0, 0);
    await setBotConfigValue('AUTOGEN_DEPOTBOX_NEXT_RUN_AT', tomorrow.toISOString());
    return;
  }

  const nextRunRaw = await getBotConfigValue('AUTOGEN_DEPOTBOX_NEXT_RUN_AT', false);
  const nextRunMs = nextRunRaw ? Date.parse(nextRunRaw) : 0;
  if (!Number.isFinite(nextRunMs) || nextRunMs <= 0) {
    await initializeDepotBoxAutogenSchedule({ startDelayMs: 60_000 });
    return;
  }
  if (nextRunMs > Date.now()) return;

  const operatorUser = await resolveAutogenOperatorUser();
  if (!operatorUser || !(await hasAutogenProviderKey('depotbox'))) {
    await scheduleNextDepotBoxAutogenTick(dayState.dailyLimit);
    return;
  }

  depotBoxAutogenTickRunning = true;

  try {
    const { results } = await runDepotBoxAutogenBatch(client, operatorUser, {
      limit: 1,
      updateDayCount: true,
    });

    if (results.length > 0) {
      const notable = results.some((item) => item.status === 'added' || item.status === 'failed');
      if (notable) {
        await sendSystemEmbeds(client, formatAutogenSummary(results, 1, 'depotbox'));
      }
    }

    await scheduleNextDepotBoxAutogenTick(dayState.dailyLimit);
  } catch (e) {
    console.error('[Autogen] DepotBox tick failed:', e);
    await scheduleNextDepotBoxAutogenTick(dayState.dailyLimit);
  } finally {
    depotBoxAutogenTickRunning = false;
  }
}

async function maybeRunDailyAutogen(client) {
  if (!(await isAutogenEnabled())) return;

  const mode = await getAutogenMode();
  if (mode === 'depotbox') {
    return maybeRunDepotBoxAutogenTick(client);
  }
  if (mode === 'upstream') {
    return maybeRunUpstreamAutogenTick(client);
  }

  if (autogenRunning) return;

  const lastRunRaw = await getBotConfigValue('AUTOGEN_LAST_RUN_AT', false);
  const lastRunMs = lastRunRaw ? Date.parse(lastRunRaw) : 0;
  if (Number.isFinite(lastRunMs) && lastRunMs > 0 && Date.now() - lastRunMs < 24 * 60 * 60 * 1000) {
    return;
  }

  const operatorUser = await resolveAutogenOperatorUser();
  if (!operatorUser) {
    await setBotConfigValue('AUTOGEN_LAST_RUN_AT', new Date().toISOString());
    await sendSystemAlert(client, 'Autogen is enabled, but no OWNER/ADMIN user exists to own generated manifests.');
    return;
  }

  if (!(await hasAutogenProviderKey(mode))) {
    await setBotConfigValue('AUTOGEN_LAST_RUN_AT', new Date().toISOString());
    await sendSystemAlert(
      client,
      mode === 'depotbox'
        ? 'DepotBox autogen mode is enabled, but DEPOTBOX_API_KEY is not configured.'
        : 'Autogen is enabled, but no upstream provider key is configured (RYUU_API_KEY, MORRENUS_API_KEY, or DEPOTBOX_API_KEY).',
    );
    return;
  }

  autogenRunning = true;

  try {
    const limit = await getAutogenDailyLimit(mode);
    const { batch, results } = await runAutogenBatch(client, operatorUser, { limit });
    await setBotConfigValue('AUTOGEN_LAST_RUN_AT', new Date().toISOString());
    if (batch.length > 0 || results.length > 0) {
      await sendSystemEmbeds(client, formatAutogenSummary(results, batch.length, mode));
    }
  } catch (e) {
    console.error('[Autogen] Daily run failed:', e);
    await sendSystemEmbeds(client, [buildAutogenErrorEmbed('Autogen Daily Run Failed', e.message || 'unknown error')]);
  } finally {
    autogenRunning = false;
  }
}

async function syncYouTubeVideos() {
  await syncYouTubeVideosToDb(prisma, { maxResults: 10 });
}

// --- Image Similarity Detection & Softban System ---
const softbannedUserIds = new Set();
let patternImagesCache = [];
const checkedAvatarsCache = new Map();
const avatarCacheDuration = 60 * 60 * 1000; // 1 hour

// --- Economy Suite Module Variables ---
const activeTriviaQuestion = new Map(); // Key: channelId, Value: { question, answer, reward, options, msgId }
const SHOP_COLOR_ROLE_PREFIX = 'OpenSteam Color:';

async function getProtectedShopTargetReason(targetUser, targetMember) {
  return getProtectedModerationReason(prisma, targetUser, targetMember, { action: 'timeout' });
}

async function assignVisibleShopColorRole(guild, member, hexColor, purchaserTag) {
  const botMember = await guild.members.fetchMe();
  const botHighestPosition = botMember.roles.highest.position;
  if (botHighestPosition < 1) {
    throw new Error('BOT_ROLE_TOO_LOW');
  }

  if (member.roles.highest.position >= botHighestPosition) {
    throw new Error('MEMBER_ROLE_ABOVE_BOT');
  }

  const oldColorRoles = member.roles.cache.filter(
    (role) => role.name.startsWith(SHOP_COLOR_ROLE_PREFIX) && !role.managed
  );
  for (const oldRole of oldColorRoles.values()) {
    await member.roles.remove(oldRole).catch(() => {});
    if (oldRole.members.cache.size === 0) {
      await oldRole.delete('Replaced shop color role').catch(() => {});
    }
  }

  const memberHighestPosition = Math.max(
    0,
    ...member.roles.cache
      .filter((role) => role.id !== guild.id)
      .map((role) => role.position)
  );

  const role = await guild.roles.create({
    name: `${SHOP_COLOR_ROLE_PREFIX} ${member.user.username}`.slice(0, 100),
    color: hexColor,
    reason: `Custom Color Role purchased by ${purchaserTag}`,
  });

  await member.roles.add(role);

  const targetPosition = Math.min(memberHighestPosition + 1, botHighestPosition - 1);
  if (targetPosition >= 1 && role.position < targetPosition) {
    await role.setPosition(targetPosition, { reason: 'Lift shop color role above member plan roles' });
  }

  return role;
}

const GRANTROLE_CONCURRENCY = 25;
const GRANTROLE_MAX_RETRIES = 4;

function getDiscordRetryAfterMs(err) {
  if (!err) return null;
  if (typeof err.retryAfter === 'number') return Math.ceil(err.retryAfter * 1000);
  if (typeof err.retry_after === 'number') return Math.ceil(err.retry_after * 1000);
  const raw = err.rawError?.retry_after;
  if (typeof raw === 'number') return Math.ceil(raw * 1000);
  return null;
}

async function grantRoleWithRetry(member, grantRole, reason, attempt = 0) {
  try {
    await member.roles.add(grantRole, reason);
    return { ok: true, memberId: member.id };
  } catch (err) {
    const retryAfterMs = getDiscordRetryAfterMs(err);
    const isRateLimit = err?.status === 429 || err?.code === 429 || retryAfterMs != null;
    if (isRateLimit && attempt < GRANTROLE_MAX_RETRIES) {
      const waitMs = retryAfterMs || (500 * (attempt + 1));
      await new Promise((resolve) => setTimeout(resolve, waitMs + 50));
      return grantRoleWithRetry(member, grantRole, reason, attempt + 1);
    }
    return { ok: false, memberId: member.id, error: err?.message || String(err) };
  }
}

async function runParallelPool(items, concurrency, worker) {
  if (items.length === 0) return [];

  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );

  return results;
}

async function collectGrantRoleCandidates(guild, hasRoleId, grantRoleId) {
  await Promise.all([
    guild.members.fetch(),
    guild.roles.fetch(hasRoleId),
  ]);

  const sourceRole = guild.roles.cache.get(hasRoleId);
  const memberPool = sourceRole?.members?.size
    ? sourceRole.members
    : guild.members.cache;

  return memberPool.filter(
    (member) =>
      !member.user.bot &&
      member.roles.cache.has(hasRoleId) &&
      !member.roles.cache.has(grantRoleId)
  );
}

const TRIVIA_POOL = [
  { q: "What was the first commercial video game?", a: "computer space", options: ["Pong", "Computer Space", "Pac-Man", "Space Invaders"] },
  { q: "Which game holds the record for the best-selling video game of all time?", a: "minecraft", options: ["Tetris", "GTA V", "Minecraft", "Wii Sports"] },
  { q: "In the game 'Pac-Man', what is the name of the red ghost?", a: "blinky", options: ["Blinky", "Pinky", "Inky", "Clyde"] },
  { q: "What is the name of the protagonist in 'The Legend of Zelda' series?", a: "link", options: ["Zelda", "Link", "Ganon", "Epona"] },
  { q: "Which company created the gaming franchise 'Halo'?", a: "bungie", options: ["Microsoft", "Bungie", "343 Industries", "Epic Games"] },
  { q: "What was the development codename for the original Nintendo Wii?", a: "revolution", options: ["Dolphin", "Revolution", "Project Reality", "Atlantis"] },
  { q: "Who is the creator of the popular indie game 'Minecraft'?", a: "notch", options: ["Notch", "Jeb", "C418", "Herobrine"] }
];

function logSecurityEvent(level, message, details = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [SECURITY] [${level}] ${message}`, JSON.stringify(details));

  try {
    const logDir = path.join(__dirname, '../data/logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'security.log');
    fs.appendFileSync(logFile, `[${timestamp}] [${level}] ${message} ${JSON.stringify(details)}\n`);
  } catch (err) {
    console.error('[Security Logger] Failed to write to security.log:', err.message);
  }

  try {
    logToBetterStack(`[SECURITY] [${level}] ${message} ${JSON.stringify(details)}`, level === 'CRITICAL' || level === 'ERROR' ? 'ERROR' : 'INFO');
  } catch (err) { }
}

// --- Perceptual Hashing (pHash) & Discrete Cosine Transform (DCT) Model ---
const cosTable = [];
const dctSize = 32;
for (let i = 0; i < dctSize; i++) {
  cosTable[i] = [];
  for (let j = 0; j < dctSize; j++) {
    cosTable[i][j] = Math.cos(((2 * i + 1) * j * Math.PI) / (2 * dctSize));
  }
}

function computePHash(greyscaleBuffer) {
  const matrix = [];
  for (let i = 0; i < 32; i++) {
    matrix[i] = [];
    for (let j = 0; j < 32; j++) {
      matrix[i][j] = greyscaleBuffer[i * 32 + j];
    }
  }

  // Compute 2D DCT on the top-left 8x8 low-frequency structural components
  const dct = [];
  for (let u = 0; u < 8; u++) {
    dct[u] = [];
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          sum += matrix[x][y] * cosTable[x][u] * cosTable[y][v];
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[u][v] = 0.25 * cu * cv * sum;
    }
  }

  // Extract top-left 8x8 coefficients (excluding average illumination component at 0,0)
  const coefficients = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      if (u === 0 && v === 0) continue;
      coefficients.push(dct[u][v]);
    }
  }

  const average = coefficients.reduce((sum, val) => sum + val, 0) / coefficients.length;

  let hash = '';
  for (const val of coefficients) {
    hash += val > average ? '1' : '0';
  }
  return hash;
}

function getHammingSimilarity(hash1, hash2) {
  let differences = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) differences++;
  }
  return 1 - (differences / hash1.length);
}

async function loadPatternImages() {
  const patternDir = path.join(__dirname, '../patern');
  if (!fs.existsSync(patternDir)) {
    logSecurityEvent('WARN', `Pattern directory does not exist at ${patternDir}`);
    return;
  }

  const files = fs.readdirSync(patternDir);
  patternImagesCache = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      const filePath = path.join(patternDir, file);
      try {
        const buffer = await sharp(filePath)
          .resize(32, 32, { fit: 'fill' })
          .greyscale()
          .raw()
          .toBuffer();

        const hash = computePHash(buffer);
        patternImagesCache.push({
          name: file,
          hash: hash
        });
        console.log(`[Image Matcher] Loaded DCT pHash for pattern: ${file}`);
      } catch (err) {
        logSecurityEvent('ERROR', `Failed to load pattern image ${file}`, { error: err.message });
      }
    }
  }
  logSecurityEvent('INFO', `Loaded ${patternImagesCache.length} pattern images with structural DCT pHash signatures from ${patternDir}`, { loadedImages: patternImagesCache.map(p => p.name) });
}

async function checkImageSimilarity(inputSource, threshold = 0.80) {
  if (patternImagesCache.length === 0) return { match: false };

  try {
    let inputBuffer;
    if (Buffer.isBuffer(inputSource)) {
      inputBuffer = inputSource;
    } else if (typeof inputSource === 'string' && (inputSource.startsWith('http://') || inputSource.startsWith('https://'))) {
      const response = await axios.get(inputSource, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });
      inputBuffer = Buffer.from(response.data);
    } else if (typeof inputSource === 'string' && fs.existsSync(inputSource)) {
      inputBuffer = fs.readFileSync(inputSource);
    } else {
      return { match: false };
    }

    const processedInput = await sharp(inputBuffer)
      .resize(32, 32, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    const inputHash = computePHash(processedInput);

    for (const pattern of patternImagesCache) {
      const similarity = getHammingSimilarity(inputHash, pattern.hash);

      if (similarity >= threshold) {
        logSecurityEvent('WARN', `Perceptual DCT pHash similarity match detected! Pattern: ${pattern.name}, Similarity: ${(similarity * 100).toFixed(1)}%`, { pattern: pattern.name, similarity });
        return {
          match: true,
          patternName: pattern.name,
          similarity: similarity
        };
      }
    }
  } catch (err) {
    logSecurityEvent('ERROR', `Error processing image for structural pHash similarity: ${err.message}`, { error: err.stack, inputSource });
  }
  return { match: false };
}

async function checkUserAvatar(member, threshold = 0.80) {
  const userId = member.id;
  const avatarUrl = member.user.displayAvatarURL({ forceStatic: true, extension: 'png', size: 128 });

  if (!avatarUrl) return { match: false };

  const cached = checkedAvatarsCache.get(userId);
  if (cached && cached.avatarUrl === avatarUrl && (Date.now() - cached.timestamp < avatarCacheDuration)) {
    return cached.result;
  }

  const result = await checkImageSimilarity(avatarUrl, threshold);
  checkedAvatarsCache.set(userId, {
    avatarUrl,
    timestamp: Date.now(),
    result
  });
  return result;
}

async function softbanMember(member, reason, client, moderatorUser = null) {
  try {
    const username = member.user.tag;
    const userId = member.id;
    const guild = member.guild;

    logSecurityEvent('CRITICAL', `Initiating Auto-Softban for user ${username} (${userId})`, { reason });

    // 1. Add to softbanned set to bypass the web-unban on guildBanRemove
    softbannedUserIds.add(userId);

    // 2. Send warning DM if possible
    try {
      await sendUserDirectMessage(member, `⚠️ You have been softbanned from **${guild.name}** and your messages have been purged for posting/using blacklisted pattern images.`);
    } catch (e) {
      logSecurityEvent('WARN', `Could not send DM to user ${userId} before softban`, { error: e.message });
    }

    // 3. Perform the ban (purging last 7 days of messages)
    await guild.members.ban(userId, {
      deleteMessageSeconds: 604800, // 7 days
      reason: `[Auto-Softban] ${reason}`
    });

    // 4. Immediately unban the user (completing the softban)
    await guild.members.unban(userId, 'Softban unban');

    logSecurityEvent('INFO', `Successfully completed Discord Softban (ban + unban) for ${username} (${userId}). Messages purged.`, { reason });

    // 5. Update the user status on the web (OpenSteam DB)
    const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });
    if (dbUser) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { isBanned: true }
      });
      await prisma.apiKey.updateMany({
        where: { userId: dbUser.id },
        data: { enabled: false, adminDisable: true }
      });

      await prisma.sentinelLog.create({
        data: {
          userId: dbUser.id,
          action: 'AUTO_JAIL',
          score: 100,
          reason: `Auto-Softban: ${reason}`,
          details: JSON.stringify({ source: 'DiscordBotDaemon', action: 'SOFTBAN', reason })
        }
      });

      logSecurityEvent('INFO', `Banned linked user account on web platform for ${username} (${userId})`, { webUserId: dbUser.id });

      if (dbUser.email) {
        await sendBrandedEmail(
          dbUser.email,
          'Account Suspended - OpenSteam',
          '🔴 Account Suspended',
          `Your OpenSteam account has been suspended because you were softbanned from the official Discord server for posting or using blacklisted pattern images. Reason: ${reason}`,
          '#ef4444'
        ).catch((err) => {
          logSecurityEvent('ERROR', `Failed to send branded suspension email to ${dbUser.email}`, { error: err.message });
        });
      }
    } else {
      await prisma.sentinelLog.create({
        data: {
          userId: null,
          action: 'AUTO_JAIL',
          score: 100,
          reason: `Auto-Softban (unlinked user): ${reason}`,
          details: JSON.stringify({ source: 'DiscordBotDaemon', discordId: userId, tag: username, action: 'SOFTBAN' })
        }
      });
      logSecurityEvent('INFO', `Logged softban for unlinked/guest user ${username} (${userId}) in SentinelLog`, { reason });
    }

    // --- Record to Punishment Logging (AuditLog Table) ---
    try {
      let punisherId = moderatorUser ? moderatorUser.id : null;
      if (!punisherId) {
        const primaryOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
        if (primaryOwner) {
          punisherId = primaryOwner.id;
        } else {
          const anyAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
          if (anyAdmin) punisherId = anyAdmin.id;
        }
      }

      if (punisherId) {
        await prisma.auditLog.create({
          data: {
            userId: punisherId,
            action: 'PUNISHMENT_LOG',
            targetId: userId,
            details: JSON.stringify({
              username: username,
              discordId: userId,
              type: moderatorUser ? 'Manual Softban' : 'Auto Softban',
              proof: 'Automated match signature: image/avatar pattern comparison',
              description: `Softbanned: ${reason}`
            }),
            ip: 'DiscordBot'
          }
        });
        logSecurityEvent('INFO', `Successfully recorded punishment log in AuditLog table for target ${username} (${userId})`, { punisherId });
      } else {
        logSecurityEvent('WARN', `Could not find an Owner/Admin account in DB to record auto-softban to Punishment Logging.`, { targetId: userId });
      }
    } catch (punishErr) {
      logSecurityEvent('ERROR', `Failed to write Punishment Logging AuditLog`, { error: punishErr.message });
    }

    // 6. Send alert to management/alerts channel
    await sendSystemAlert(client, `🛡️ **Security Alert: Auto-Softban**\n**User**: ${username} (<@${userId}>)\n**Action**: Softbanned (Kicked + Messages Purged)\n**Reason**: ${reason}`);

  } catch (err) {
    logSecurityEvent('ERROR', `Error executing softban for ${member.id}`, { error: err.message });
  }
}

async function startBot() {
  console.log('--- OpenSteam Bot Starting ---');

  if (!process.env.DATABASE_URL?.trim()) {
    console.warn('[Bot Manager] DATABASE_URL is not set — config will only load from environment variables.');
  }

  // Fetch guild bot token (primary for slash commands even during DM/OAuth failover)
  let activeBot;
  const MAX_BOOT_RETRIES = 20;

  for (let i = 0; i < MAX_BOOT_RETRIES; i++) {
    try {
      activeBot = await resolveGuildBotToken();
      if (activeBot?.token) break;
      console.warn(
        `[Bot Manager] Discord token not found in DB or env (attempt ${i + 1}/${MAX_BOOT_RETRIES}). ` +
          'Set DISCORD_BOT_TOKEN in the bot environment or Admin → System Config.',
      );
    } catch (e) {
      console.warn(
        `[Bot Manager] Boot config read failed (attempt ${i + 1}/${MAX_BOOT_RETRIES}): ${e?.message || e}. Retrying in 5s…`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  if (!activeBot?.token) {
    const envToken = process.env.DISCORD_BOT_TOKEN?.trim() || process.env.DISCORD_BACKUP_BOT_TOKEN?.trim();
    if (envToken) {
      activeBot = {
        token: envToken,
        source: process.env.DISCORD_BOT_TOKEN?.trim() ? 'primary' : 'backup',
      };
      console.warn('[Bot Manager] Using Discord token from environment after DB retries failed.');
    }
  }

  if (!activeBot?.token) {
    console.error(
      'CRITICAL: No Discord bot token available. Fix DATABASE_URL so the bot can read system_configs, ' +
        'or set DISCORD_BOT_TOKEN on the bot daemon service.',
    );
    process.exit(1);
  }

  console.log(`[Bot Manager] Using ${activeBot.source} bot token for guild gateway`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,  // Required to read message.content (privileged intent)
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
  });

  // Gateway/websocket resilience: without an 'error' listener, discord.js can
  // throw on transient socket errors and crash the process. Log and let the
  // built-in auto-reconnect recover instead of dying.
  client.on('error', (err) => {
    console.error('[Bot Daemon] Discord client error:', err?.message || err);
    try { logToBetterStack(`Discord client error: ${err?.message || err}`, 'ERROR'); } catch (_) {}
  });
  client.on('shardError', (err, shardId) => {
    console.error(`[Bot Daemon] Shard ${shardId} error:`, err?.message || err);
    try { logToBetterStack(`Discord shard ${shardId} error: ${err?.message || err}`, 'ERROR'); } catch (_) {}
  });
  client.on('shardDisconnect', (event, shardId) => {
    console.warn(`[Bot Daemon] Shard ${shardId} disconnected (code ${event?.code}). Awaiting auto-reconnect…`);
  });
  client.on('shardReconnecting', (shardId) => {
    console.warn(`[Bot Daemon] Shard ${shardId} reconnecting…`);
  });
  client.on('shardResume', (shardId, replayed) => {
    console.log(`[Bot Daemon] Shard ${shardId} resumed (${replayed} events replayed).`);
  });

  // 2.5 Initialize S3 client if configured
  botS3Client = null;
  if (process.env.AWS_S3_BUCKET_NAME) {
    botS3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
    });
  }

  client.once(Events.ClientReady, async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log('Bot is now online and listening for slash commands.');

    try {
      const uploadChannelId = await getManifestUploadChannelId(prisma);
      if (uploadChannelId) {
        console.log(`[ManifestUpload] Watching channel ${uploadChannelId} for zip/rar/7z uploads.`);
      } else {
        console.warn('[ManifestUpload] No DISCORD_MANIFEST_UPLOAD_CHANNEL_ID configured (DB or env).');
      }

      const addedGamesChannelId = await getAddedGamesChannelId(prisma);
      if (addedGamesChannelId) {
        console.log(`[GameAdded] Announcements will post to channel ${addedGamesChannelId}.`);
      } else {
        console.warn('[GameAdded] No DISCORD_ADDED_GAMES_CHANNEL_ID configured — use /set added-games-channel.');
      }
    } catch (e) {
      console.warn('[ManifestUpload] Could not resolve upload channel on startup:', e?.message || e);
    }

    applyOpenSteamListeningPresence(client);

    try {
      const { startRenderKeepAlive } = require('./render-keepalive');
      startRenderKeepAlive(client);
    } catch (e) {
      console.warn('[KeepAlive] Failed to start:', e?.message || e);
    }

    ensureVerifyMessage(client).catch((err) => console.error('[Verify] startup error:', err.message));
    ensurePartnershipPanel(client).catch((err) => console.error('[Partnership] startup error:', err.message));

    syncCommunityInviteLinks(prisma, {
      guildId: process.env.DISCORD_GUILD_ID?.trim() || '1205897412502224947',
      botToken: activeBot.token,
    }).then((result) => {
      if (result.ok) {
        console.log(`[CommunityInvites] Synced ${result.urls.length} active invite(s) for ${getSiteHostLabel()}/discord`);
      }
    }).catch((err) => console.warn('[CommunityInvites] Startup sync failed:', err?.message || err));

    // Register zips under STORAGE_PATH/manifests that are not yet in Postgres
    if (process.env.STORAGE_SYNC_ON_START !== '0') {
      const { syncStorageManifestsToDb } = require('./lib/sync-storage-manifests');
      const { fetchSteamAppList } = require('./lib/steam-app-list');
      (async () => {
        try {
          let nameLookup;
          try {
            const apps = await fetchSteamAppList(getBotConfigValue);
            const map = new Map(apps.map((app) => [String(app.appid), app.name]));
            nameLookup = (appId) => map.get(String(appId));
          } catch (_) {
            nameLookup = () => undefined;
          }
          const result = await syncStorageManifestsToDb(prisma, {
            nameLookup,
            onProgress: ({ added, pending }) => {
              if (added === pending || added % 5000 === 0) {
                console.log(`[StorageSync] Registered ${added}/${pending} new manifest(s) from local storage`);
              }
            },
          });
          if (result.added > 0) {
            console.log(
              `[StorageSync] Complete: ${result.added} added, ${result.alreadyInDb} already in DB, ${result.scanned} on disk`,
            );
          }
        } catch (err) {
          console.warn('[StorageSync] Startup sync failed:', err?.message || err);
        }
      })();
    }

    // Initial sync
    syncYouTubeVideos();

    // Load pattern images for similarity checks
    loadPatternImages().catch(err => console.error('[Image Matcher] Initial load error:', err));

    // Refresh pattern cache every 30 minutes so newly added pattern images are picked up without a restart
    setInterval(() => {
      loadPatternImages().catch(err => console.error('[Image Matcher] Refresh error:', err));
    }, 30 * 60 * 1000);

    setInterval(() => {
      processGiveawayTimers(client, prisma).catch((err) => {
        console.error('[Giveaway] timer error:', err.message);
      });
    }, 30 * 1000);

    setTimeout(() => {
      maybeRunDailyAutogen(client).catch((err) => console.error('[Autogen] startup check error:', err.message));
      maybeRunHeavygenTick(client).catch((err) => console.error('[Heavygen] startup check error:', err.message));
    }, 30 * 1000);

    setInterval(() => {
      maybeRunDailyAutogen(client).catch((err) => console.error('[Autogen] scheduler error:', err.message));
      maybeRunHeavygenTick(client).catch((err) => console.error('[Heavygen] scheduler error:', err.message));
    }, 60 * 1000);

    // Periodically clear temporary data / sync features
    setInterval(async () => {
      // Cleanup logic if any
      syncYouTubeVideos();

      syncCommunityInviteLinks(prisma, {
        guildId: process.env.DISCORD_GUILD_ID?.trim() || '1205897412502224947',
        botToken: activeBot.token,
      }).catch((err) => console.warn('[CommunityInvites] Periodic sync failed:', err?.message || err));

      // Auto-generate trial tests for trial mods whose trial ends in < 24h
      try {
        const trialMods = await prisma.user.findMany({
          where: { role: 'TRIAL_MODERATOR', trialStartDate: { not: null } },
          include: { trialTests: { where: { status: { in: ['ACTIVE', 'PENDING', 'SUBMITTED', 'PASSED'] } } } }
        });
        for (const mod of trialMods) {
          if (!mod.trialStartDate || mod.trialTests.length > 0) continue;
          const trialEnd = new Date(mod.trialStartDate.getTime() + 14 * 24 * 60 * 60 * 1000);
          const timeLeft = trialEnd.getTime() - Date.now();
          if (timeLeft > 24 * 60 * 60 * 1000 || timeLeft < 0) continue;
          // Generate test with baseline questions
          const questions = [
            { section: 'General Knowledge', question: 'What role hierarchy does OpenSteam follow?', options: ['User → Admin → Owner', 'User → Moderator → Admin → Owner', 'User → Trial Moderator → Moderator → Admin → Owner', 'Member → Staff → Admin'], correctIndex: 2 },
            { section: 'Moderation', question: 'When should a moderator escalate to Admin?', options: ['Only when they feel like it', 'When the issue involves banning, system changes, or complex disputes', 'Never', 'Only during weekdays'], correctIndex: 1 },
            { section: 'Security', question: 'What should a moderator do if they suspect API key abuse?', options: ['Nothing', 'Revoke the keys, restrict the user, escalate to Admin', 'Give more keys', 'Ask politely to stop'], correctIndex: 1 },
            { section: 'Ethics', question: 'Can a moderator use privileges for personal gain?', options: ['Yes', 'No, only for legitimate moderation purposes', 'Sometimes', 'Only if no one is watching'], correctIndex: 1 },
            { section: 'Ethics', question: 'What if a moderator has a conflict with a user they need to moderate?', options: ['Ban them', 'Recuse themselves and ask another mod', 'Ignore it', 'Abuse power'], correctIndex: 1 },
            { section: 'Community', question: 'How should moderators interact with the community?', options: ['Be authoritarian', 'Be professional, helpful, fair, and consistent', 'Avoid all interaction', 'Only talk to premium users'], correctIndex: 1 },
            { section: 'API', question: 'What happens when a user exceeds their API rate limit?', options: ['Account deleted', '429 response and temporary throttle', 'Nothing', 'Auto-upgrade'], correctIndex: 1 },
            { section: 'General Knowledge', question: 'What is the minimum score to pass an application?', options: ['200/475', '310/475', '400/475', '250/475'], correctIndex: 1 },
          ].sort(() => Math.random() - 0.5);
          const selected = questions.slice(0, Math.min(15, questions.length));
          const finalQs = selected.map(q => {
            const idx = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
            return { ...q, options: idx.map(i => q.options[i]), correctIndex: idx.indexOf(q.correctIndex) };
          });
          await prisma.trialTest.create({
            data: { userId: mod.id, questions: finalQs, maxScore: finalQs.length, passingScore: Math.ceil(finalQs.length * 0.7), status: 'ACTIVE', generatedAt: new Date(), expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }
          });
          console.log(`[Trial] Auto-generated test for ${mod.username}`);
        }
      } catch (e) {
        console.warn('[Trial] Auto-generation error:', e.message);
      }
    }, 1000 * 60 * 60); // Hourly
  });

  // Handle SIGINT/SIGTERM for graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[Bot Manager] SIGINT received. Shutting down...');
    await prisma.$disconnect();
    client.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Bot Manager] SIGTERM received. Shutting down...');
    await prisma.$disconnect();
    client.destroy();
    process.exit(0);
  });

  // Helper for admin check
  async function checkAdmin(interaction) {
    const user = await prisma.user.findUnique({
      where: { discordId: interaction.user.id }
    });
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      await interaction.reply({ content: '❌ **Access Denied**: You do not have the required administrative permissions on the OpenSteam platform.', flags: MessageFlags.Ephemeral });
      return null;
    }
    return user;
  }

  // Helper for staff check (Moderator or Admin)
  async function checkStaff(interaction) {
    const user = await prisma.user.findUnique({
      where: { discordId: interaction.user.id }
    });
    if (!user || !['TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'].includes(user.role)) {
      await interaction.reply({ content: '❌ **Access Denied**: Only Moderators and Administrators can use this command on OpenSteam.', flags: MessageFlags.Ephemeral });
      return null;
    }
    return user;
  }

  // Helper to find or sync user in DB using Discord User object
  async function getOrSyncUser(discordUser) {
    return getOrSyncDiscordUser(prisma, discordUser);
  }

  // 3. Command Handling
  client.on('interactionCreate', async interaction => {
    if (interaction.isMessageContextMenuCommand()) {
      if (interaction.commandName === 'Report Message') {
        try {
          if (!interaction.guild) {
            return interaction.reply({ content: '❌ **Error**: Reports can only be submitted within a server.', flags: MessageFlags.Ephemeral });
          }
          const targetMsg = interaction.targetMessage;
          if (!targetMsg) {
            return interaction.reply({ content: '❌ **Error**: Could not retrieve target message.', flags: MessageFlags.Ephemeral });
          }
          await triggerModeratorReviewFlow(
            interaction.guild,
            interaction.user,
            targetMsg,
            targetMsg.author,
            targetMsg.content,
            targetMsg.url,
            targetMsg.attachments.first()?.url,
            interaction
          );
        } catch (err) {
          console.error('[ContextMenu Report Error]', err.message);
          await interaction.reply({ content: `❌ **Error**: Failed to process report: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'drop') {
        try {
          const focused = interaction.options.getFocused(true);
          if (focused.name === 'platform') {
            const { listDropPlatforms } = require('./lib/drop-logic.js');
            const query = String(focused.value || '').toLowerCase();
            const choices = listDropPlatforms()
              .filter((p) => p.includes(query))
              .slice(0, 25)
              .map((p) => ({
                name: p.charAt(0).toUpperCase() + p.slice(1),
                value: p,
              }));
            await interaction.respond(choices);
          } else {
            await interaction.respond([]);
          }
        } catch (err) {
          console.error('[Drop] Autocomplete error:', err.message);
          await interaction.respond([]).catch(() => {});
        }
      } else if (interaction.commandName === 'onlinefix') {
        try {
          const focused = interaction.options.getFocused(true);
          if (focused.name === 'name') {
            const { searchOnlineFixViaApi } = require('./lib/onlinefix-api');
            const games = await searchOnlineFixViaApi(String(focused.value || ''), {
              limit: 25,
            }, { prismaClient: prisma });
            const choices = games.map((game) => ({
              name: game.name.slice(0, 100),
              value: game.name.slice(0, 100),
            }));
            await interaction.respond(choices);
          } else {
            await interaction.respond([]);
          }
        } catch (err) {
          console.error('[OnlineFix] Autocomplete error:', err.message);
          await interaction.respond([]).catch(() => {});
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    // ... rest of interaction handler ...

    if (interaction.commandName === 'admin') {
      const platformUser = await prisma.user.findUnique({
        where: { discordId: interaction.user.id }
      });
      const sub = interaction.options.getSubcommand();

      if (sub === 'softban' || sub === 'kick') {
        if (!platformUser || !['TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'].includes(platformUser.role)) {
          return interaction.reply({ content: '❌ **Access Denied**: You must be a Trial Moderator or higher to perform this command.', flags: MessageFlags.Ephemeral });
        }
      } else {
        if (!platformUser || !['ADMIN', 'OWNER'].includes(platformUser.role)) {
          return interaction.reply({ content: '❌ **Access Denied**: You do not have the required administrative permissions on the OpenSteam platform.', flags: MessageFlags.Ephemeral });
        }
      }

      const adminUser = platformUser;

      if (sub === 'stats') {
        await interaction.deferReply();
        try {
          const [userCount, manifestCount, keyCount, totalRequests, discordGens, webGens] = await Promise.all([
            prisma.user.count(),
            prisma.manifest.count(),
            prisma.apiKey.count(),
            prisma.apiUsage.count(),
            prisma.webGeneration.count({ where: { source: 'discord' } }),
            prisma.webGeneration.count({ where: { source: 'web' } })
          ]);

          const embed = new EmbedBuilder()
            .setTitle('📊 OpenSteam System Health')
            .setColor(0x6366f1)
            .addFields(
              { name: 'Accounts', value: `${userCount}`, inline: true },
              { name: 'Manifests', value: `${manifestCount}`, inline: true },
              { name: 'API Keys', value: `${keyCount}`, inline: true },
              { name: 'Total Requests', value: `${totalRequests.toLocaleString()}`, inline: true },
              { name: 'Status', value: '🟢 Operational', inline: true },
              { name: 'Gen Breakdown', value: `🌐 Web: ${webGens} | 🤖 Bot: ${discordGens}`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'OpenSteam Security Command' });

          await interaction.editReply({ embeds: [embed] });
        } catch (e) {
          await interaction.editReply('❌ Error fetching stats.');
        }
      }

      if (sub === 'user-info') {
        const targetId = interaction.options.getString('user');
        await interaction.deferReply();

        try {
          const user = await prisma.user.findFirst({
            where: { OR: [{ id: targetId }, { discordId: targetId }] },
            include: { _count: { select: { apiKeys: true, manifests: true } } }
          });

          if (!user) return interaction.editReply('❌ User not found.');

          const embed = new EmbedBuilder()
            .setTitle(`👤 User Info: ${user.username}`)
            .setColor(user.isBanned ? 0xef4444 : 0x10b981)
            .addFields(
              { name: 'ID', value: `\`${user.id}\``, inline: false },
              { name: 'Discord', value: user.discordId ? `<@${user.discordId}>` : 'None', inline: true },
              { name: 'Plan', value: `**${user.plan}**`, inline: true },
              { name: 'Role', value: user.role, inline: true },
              { name: 'Keys', value: `${user._count.apiKeys}`, inline: true },
              { name: 'Uploads', value: `${user._count.manifests}`, inline: true },
              { name: 'Status', value: user.isBanned ? '🔴 Banned' : '🟢 Active', inline: true },
              { name: 'Joined', value: `<t:${Math.floor(new Date(user.createdAt).getTime() / 1000)}:R>`, inline: true }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        } catch (e) {
          await interaction.editReply('❌ Error fetching user info.');
        }
      }

      if (sub === 'site-set') {
        const setting = interaction.options.getString('setting');
        const value = interaction.options.getString('value');
        const { writeSiteSettings, readSiteSettings, ALLOWED_KEYS } = require('./lib/site-settings');
        if (!ALLOWED_KEYS.includes(setting)) {
          return interaction.reply({ content: '❌ Invalid setting key.', flags: MessageFlags.Ephemeral });
        }
        const updated = writeSiteSettings({ [setting]: value });
        return interaction.reply({
          content: `✅ Updated **${setting}** → \`${value}\`\nSite URL: ${updated.siteUrl}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'site-get') {
        const { readSiteSettings } = require('./lib/site-settings');
        const s = readSiteSettings();
        const embed = new EmbedBuilder()
          .setTitle('🌐 OpenSteam Site Settings')
          .setColor(0x22d3ee)
          .setDescription(Object.entries(s).map(([k, v]) => `**${k}:** ${v}`).join('\n'))
          .setFooter({ text: 'Edit with /admin site-set setting value' });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (sub === 'set-plan') {
        const targetId = interaction.options.getString('user');
        const plan = interaction.options.getString('plan');
        await interaction.deferReply();

        try {
          const user = await prisma.user.findFirst({
            where: { OR: [{ id: targetId }, { discordId: targetId }] }
          });

          if (!user) return interaction.editReply('❌ User not found.');

          await prisma.user.update({
            where: { id: user.id },
            data: { plan }
          });

          await prisma.auditLog.create({
            data: {
              userId: adminUser.id,
              action: 'UPDATE_USER_PLAN',
              targetId: user.id,
              details: `Plan updated from ${user.plan} to ${plan} via Discord Bot`,
              ip: 'DiscordBot'
            }
          });

          await interaction.editReply(`✅ Successfully updated **${user.username}** to **${plan}** plan.`);
        } catch (e) {
          await interaction.editReply('❌ Error updating plan.');
        }
      }

      if (sub === 'set-role') {
        const targetInput = interaction.options.getString('user');
        const newRole = interaction.options.getString('role');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const privilegedRoles = new Set(['ADMIN', 'OWNER']);
        if (privilegedRoles.has(newRole) && adminUser.role !== 'OWNER') {
          return interaction.editReply('❌ Only the platform **Owner** can assign **Admin** or **Owner** roles.');
        }
        if (newRole === 'OWNER' && adminUser.role !== 'OWNER') {
          return interaction.editReply('❌ Only the platform **Owner** can assign the **Owner** role.');
        }

        try {
          const resolvedId = String(targetInput || '').replace(/[<@!>]/g, '').trim();
          let user = await prisma.user.findFirst({
            where: { OR: [{ id: resolvedId }, { discordId: resolvedId }] },
          });

          if (!user && /^\d{17,20}$/.test(resolvedId) && interaction.guild) {
            try {
              const member = await interaction.guild.members.fetch(resolvedId);
              user = await getOrSyncUser(member.user);
            } catch {
              /* fall through */
            }
          }

          if (!user) {
            return interaction.editReply(
              '❌ User not found. They must be in this server so the bot can sync their Discord account.',
            );
          }

          if (user.role === 'OWNER' && adminUser.role !== 'OWNER') {
            return interaction.editReply('❌ You cannot change the role of a platform **Owner**.');
          }

          const roleLevels = {
            USER: 0,
            TRIAL_MODERATOR: 25,
            MODERATOR: 50,
            SENIOR_MODERATOR: 75,
            HEAD_MODERATOR: 80,
            EXECUTIVE_OFFICER: 90,
            ADMIN: 100,
            OWNER: 150,
          };

          await prisma.user.update({
            where: { id: user.id },
            data: {
              role: newRole,
              roleLevel: roleLevels[newRole] ?? 0,
            },
          });

          await prisma.auditLog.create({
            data: {
              userId: adminUser.id,
              action: 'UPDATE_USER_ROLE',
              targetId: user.id,
              details: `Role updated from ${user.role} to ${newRole} via Discord Bot`,
              ip: 'DiscordBot',
            },
          });

          const uploadNote = privilegedRoles.has(newRole)
            ? '\nThey can now upload manifests in the upload channel.'
            : '';

          return interaction.editReply(
            `✅ **${user.username}** (\`${user.discordId}\`) is now **${newRole}** on OpenSteam.${uploadNote}`,
          );
        } catch (e) {
          console.error('[Admin set-role]', e);
          return interaction.editReply('❌ Error updating role.');
        }
      }

      if (sub === 'lookup-key') {
        const key = interaction.options.getString('key');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const apiKey = await prisma.apiKey.findUnique({
            where: { key },
            include: { user: true, _count: { select: { usage: true } } }
          });

          if (!apiKey) return interaction.editReply('❌ API Key not found.');

          const embed = new EmbedBuilder()
            .setTitle(`🔑 API Key Lookup`)
            .setColor(0x6366f1)
            .addFields(
              { name: 'Name', value: apiKey.name, inline: true },
              { name: 'Owner', value: `${apiKey.user?.username || 'Unknown'} (\`${apiKey.user?.id || 'N/A'}\`)`, inline: true },
              { name: 'Enabled', value: apiKey.enabled ? 'Yes' : 'No', inline: true },
              { name: 'Total Usage', value: `${apiKey._count.usage}`, inline: true },
              { name: 'Created', value: new Date(apiKey.createdAt).toLocaleDateString(), inline: true }
            );

          await interaction.editReply({ embeds: [embed] });
        } catch (e) {
          await interaction.editReply('❌ Error looking up key.');
        }
      }

      if (sub === 'create-key' || sub === 'list-keys') {
        const { handleAdminCreateKey, handleAdminListKeys } = require('./lib/device-key-commands')
        if (sub === 'create-key') {
          return handleAdminCreateKey(interaction, prisma, adminUser)
        }
        return handleAdminListKeys(interaction, prisma)
      }

      if (sub === 'ban') {
        const targetIdInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided.';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const resolvedId = targetIdInput.replace(/[<@!>]/g, '');
          const user = await prisma.user.findFirst({
            where: { OR: [{ id: resolvedId }, { discordId: resolvedId }] }
          });

          if (!user) {
            // Directly ban the Discord User ID/Mention even if they are not in the DB yet
            try {
              await interaction.guild.members.ban(resolvedId, {
                reason: `[Platform Ban] Banned by ${interaction.user.tag}: ${reason}`
              });

              await prisma.auditLog.create({
                data: {
                  userId: adminUser.id,
                  action: 'BAN_USER',
                  targetId: resolvedId,
                  details: `Banned unlinked Discord User via Discord Bot. Reason: ${reason}`,
                  ip: 'DiscordBot'
                }
              });

              // Record to Punishment Logging
              try {
                await prisma.auditLog.create({
                  data: {
                    userId: adminUser.id,
                    action: 'PUNISHMENT_LOG',
                    targetId: resolvedId,
                    details: JSON.stringify({
                      username: `Discord User (${resolvedId})`,
                      discordId: resolvedId,
                      type: 'Ban',
                      proof: 'Manual direct Discord ID ban by staff',
                      description: `Banned: ${reason}`
                    }),
                    ip: 'DiscordBot'
                  }
                });
              } catch (pe) { }

              return interaction.editReply(`✅ Successfully banned Discord User \`${resolvedId}\` from the server.`);
            } catch (discordBanErr) {
              return interaction.editReply('❌ User not found in database, and failed to ban direct Discord ID/Mention.');
            }
          }

          if (user.role === 'ADMIN' || user.role === 'OWNER') {
            return interaction.editReply('❌ Cannot ban another Administrator or Owner.');
          }

          // 1. Ban on web
          await prisma.user.update({
            where: { id: user.id },
            data: { isBanned: true }
          });
          await prisma.apiKey.updateMany({
            where: { userId: user.id },
            data: { enabled: false, adminDisable: true }
          });

          // 2. Ban on Discord server
          if (user.discordId) {
            try {
              await interaction.guild.members.ban(user.discordId, {
                reason: `[Platform Ban] Banned by ${interaction.user.tag}: ${reason}`
              });
            } catch (discordBanErr) {
              console.warn(`[Admin Ban] Failed to ban Discord ID: ${discordBanErr.message}`);
            }
          }

          await prisma.sentinelLog.create({
            data: {
              userId: user.id,
              action: 'AUTO_JAIL',
              score: 100,
              reason: `Remote Ban via Discord Bot: ${reason}`,
              details: JSON.stringify({ source: 'DiscordBotDaemon', moderator: interaction.user.tag })
            }
          });

          await prisma.auditLog.create({
            data: {
              userId: adminUser.id,
              action: 'BAN_USER',
              targetId: user.id,
              details: `Banned user via Discord Bot. Reason: ${reason}`,
              ip: 'DiscordBot'
            }
          });

          if (user.discordId) {
            try {
              const discUser = await client.users.fetch(user.discordId);
              await sendUserDirectMessage(discUser, {
                embeds: [
                  new EmbedBuilder()
                    .setTitle('🚨 Web Account Banned')
                    .setDescription(
                      `Your OpenSteam account has been **permanently banned** by an administrator.\n\n**Reason:** ${reason}\n\nAll associated API keys have been suspended.`
                    )
                    .setColor(0xdc2626)
                    .setTimestamp()
                    .setFooter({ text: 'OpenSteam Network Security' }),
                ],
              });
            } catch (notifyErr) {
              console.warn('[Admin Ban] Failed to DM banned user:', notifyErr.message);
            }
          }

          // Create Punishment Log
          try {
            await prisma.auditLog.create({
              data: {
                userId: adminUser.id,
                action: 'PUNISHMENT_LOG',
                targetId: user.discordId || user.id,
                details: JSON.stringify({
                  username: user.username,
                  discordId: user.discordId || resolvedId,
                  type: 'Ban',
                  proof: 'Manual ban by staff',
                  description: `Banned: ${reason}`
                }),
                ip: 'DiscordBot'
              }
            });
          } catch (pe) { }

          await interaction.editReply(`✅ Successfully banned **${user.username}** on the web platform and Discord server.`);
        } catch (e) {
          console.error('[Admin Ban Command Error]', e);
          await interaction.editReply(`❌ Error processing ban: ${e.message}`);
        }
      }

      if (sub === 'unban') {
        const targetIdInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided.';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const resolvedId = targetIdInput.replace(/[<@!>]/g, '');
          const user = await prisma.user.findFirst({
            where: { OR: [{ id: resolvedId }, { discordId: resolvedId }] }
          });

          if (!user) {
            // Directly unban the Discord User ID/Mention even if they are not in the DB yet
            try {
              await interaction.guild.members.unban(resolvedId, `[Platform Unban] Unbanned by ${interaction.user.tag}: ${reason}`);

              await prisma.auditLog.create({
                data: {
                  userId: adminUser.id,
                  action: 'UNBAN_USER',
                  targetId: resolvedId,
                  details: `Unbanned unlinked Discord User via Discord Bot. Reason: ${reason}`,
                  ip: 'DiscordBot'
                }
              });

              return interaction.editReply(`✅ Successfully unbanned Discord User ID \`${resolvedId}\` from the server.`);
            } catch (discordUnbanErr) {
              return interaction.editReply(`❌ User not found in database, and failed to unban Discord ID: ${discordUnbanErr.message}`);
            }
          }

          // 1. Unban on web
          await prisma.user.update({
            where: { id: user.id },
            data: { isBanned: false, jailUntil: null, jailLevel: 0, riskScore: 0 }
          });
          await prisma.apiKey.updateMany({
            where: { userId: user.id },
            data: { enabled: true, adminDisable: false }
          });

          // Lift IP blacklist
          if (user.lastIp && user.lastIp !== 'unknown') {
            await prisma.blacklistedIp.deleteMany({
              where: { ip: user.lastIp }
            }).catch(() => { });
          }

          // Reset Sentinel logs
          await prisma.sentinelLog.create({
            data: {
              userId: user.id,
              action: 'AUTO_UNJAIL',
              score: 0,
              reason: `Remote Unban via Discord Bot: ${reason}`,
              details: JSON.stringify({ source: 'DiscordBotDaemon', moderator: interaction.user.tag })
            }
          });

          // 2. Unban on Discord server
          if (user.discordId) {
            try {
              await interaction.guild.members.unban(user.discordId, `[Platform Unban] Unbanned by ${interaction.user.tag}: ${reason}`);
            } catch (discordUnbanErr) {
              console.warn(`[Admin Unban] Failed to unban Discord ID: ${discordUnbanErr.message}`);
            }
          }

          await prisma.auditLog.create({
            data: {
              userId: adminUser.id,
              action: 'UNBAN_USER',
              targetId: user.id,
              details: `Unbanned user via Discord Bot. Reason: ${reason}`,
              ip: 'DiscordBot'
            }
          });

          // Create Punishment Log
          try {
            await prisma.auditLog.create({
              data: {
                userId: adminUser.id,
                action: 'PUNISHMENT_LOG',
                targetId: user.discordId || user.id,
                details: JSON.stringify({
                  username: user.username,
                  discordId: user.discordId || resolvedId,
                  type: 'Unban',
                  proof: 'Manual unban by staff',
                  description: `Unbanned: ${reason}`
                }),
                ip: 'DiscordBot'
              }
            });
          } catch (pe) { }

          await interaction.editReply(`✅ Successfully unbanned **${user.username}** on the web platform and Discord server.`);
        } catch (e) {
          console.error('[Admin Unban Command Error]', e);
          await interaction.editReply(`❌ Error processing unban: ${e.message}`);
        }
      }

      if (sub === 'softban') {
        const targetInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided.';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const userId = targetInput.replace(/[<@!>]/g, '');

          let member;
          try {
            member = await interaction.guild.members.fetch(userId);
          } catch (fetchErr) {
            return interaction.editReply(`❌ User not found in this Discord server (Guild). Make sure the ID \`${userId}\` is correct.`);
          }

          if (!member) {
            return interaction.editReply('❌ User not found in this Discord server.');
          }

          const dbTargetUser = await prisma.user.findFirst({
            where: { OR: [{ id: member.id }, { discordId: member.id }] }
          });

          if (dbTargetUser && (dbTargetUser.role === 'ADMIN' || dbTargetUser.role === 'OWNER')) {
            return interaction.editReply('❌ Cannot softban an Administrator or Owner.');
          }

          await softbanMember(member, `Manual softban by ${interaction.user.tag}: ${reason}`, client, adminUser);

          await interaction.editReply(`✅ Successfully softbanned **${member.user.tag}** (kicked, messages purged, and banned on web).`);
        } catch (e) {
          console.error('[Admin Softban Command Error]', e);
          await interaction.editReply(`❌ Error processing softban: ${e.message}`);
        }
      }

      if (sub === 'kick') {
        const targetInput = interaction.options.getString('user');
        const reason = interaction.options.getString('reason') || 'No reason provided.';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const userId = targetInput.replace(/[<@!>]/g, '');

          let member;
          try {
            member = await interaction.guild.members.fetch(userId);
          } catch (fetchErr) {
            return interaction.editReply(`❌ User not found in this Discord server (Guild). Make sure the ID \`${userId}\` is correct.`);
          }

          if (!member) {
            return interaction.editReply('❌ User not found in this Discord server.');
          }

          const dbTargetUser = await prisma.user.findFirst({
            where: { OR: [{ id: member.id }, { discordId: member.id }] }
          });

          if (dbTargetUser && (dbTargetUser.role === 'ADMIN' || dbTargetUser.role === 'OWNER')) {
            return interaction.editReply('❌ Cannot kick an Administrator or Owner.');
          }

          // 1. Kick on Discord
          await member.kick(`[Manual Kick] Kicked by ${interaction.user.tag}: ${reason}`);

          // 2. Log in SentinelLog
          if (dbTargetUser) {
            await prisma.sentinelLog.create({
              data: {
                userId: dbTargetUser.id,
                action: 'AUTO_JAIL',
                score: 50,
                reason: `Kicked via Discord Bot: ${reason}`,
                details: JSON.stringify({ source: 'DiscordBotDaemon', moderator: interaction.user.tag, action: 'KICK' })
              }
            });
          }

          // 3. Log in AuditLog (Punishment Log)
          await prisma.auditLog.create({
            data: {
              userId: adminUser.id,
              action: 'PUNISHMENT_LOG',
              targetId: userId,
              details: JSON.stringify({
                username: member.user.tag,
                discordId: userId,
                type: 'Kick',
                proof: 'Manual kick by staff',
                description: `Kicked: ${reason}`
              }),
              ip: 'DiscordBot'
            }
          });

          // 4. Send alert to management channel
          await sendSystemAlert(client, `🛡️ **Security Alert: Kick**\n**User**: ${member.user.tag} (<@${userId}>)\n**Action**: Kicked from Guild\n**Reason**: ${reason}\n**Moderator**: ${interaction.user.tag}`);

          await interaction.editReply(`✅ Successfully kicked **${member.user.tag}** from the Discord server.`);
        } catch (e) {
          console.error('[Admin Kick Command Error]', e);
          await interaction.editReply(`❌ Error processing kick: ${e.message}`);
        }
      }

      if (sub === 'manifest') {
        const appId = interaction.options.getString('appid');
        await interaction.deferReply();

        try {
          const manifest = await prisma.manifest.findUnique({
            where: { steamAppId: appId }
          });

          if (!manifest) {
            return interaction.editReply(`🔍 Manifest for \`${appId}\` does **not** exist.`);
          }

          await interaction.editReply(`📖 **Manifest Found**\n**Name**: ${manifest.name}\n**Downloads**: ${manifest.downloads}\n**Region**: GLOBAL\n**Indexed**: ${new Date(manifest.createdAt).toLocaleDateString()}`);
        } catch (e) {
          await interaction.editReply('❌ Error checking manifest.');
        }
      }

      if (sub === 'lookup-ip') {
        const ip = interaction.options.getString('ip');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const [blacklisted, logCount, logs] = await Promise.all([
            prisma.blacklistedIp.findUnique({ where: { ip } }),
            prisma.sentinelLog.count({ where: { ip } }),
            prisma.sentinelLog.findMany({
              where: { ip },
              orderBy: { createdAt: 'desc' },
              take: 5
            })
          ]);

          const embed = new EmbedBuilder()
            .setTitle(`🛡️ IP Investigation: ${ip}`)
            .setColor(blacklisted ? 0xef4444 : (logCount > 0 ? 0xf59e0b : 0x10b981))
            .addFields(
              { name: 'Status', value: blacklisted ? '🔴 BLACKLISTED' : '🟢 CLEAR/UNKNOWN', inline: true },
              { name: 'Total Violations', value: `${logCount}`, inline: true },
              { name: 'Recent Activity', value: logs.length > 0 ? logs.map(l => `[${l.action}] ${l.reason}`).join('\n') : 'No security logs found.', inline: false }
            )
            .setTimestamp();

          if (blacklisted?.reason) {
            embed.addFields({ name: 'Blacklist Reason', value: blacklisted.reason });
          }

          await interaction.editReply({ embeds: [embed] });
        } catch (e) {
          await interaction.editReply('❌ Error investigating IP.');
        }
      }

      if (sub === 'pullback') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const { runDiscordPullback } = require('./lib/discord-oauth-tokens.js');
          const targetInput = interaction.options.getString('user');
          const userId = targetInput ? targetInput.replace(/[<@!>]/g, '').trim() : null;

          if (userId) {
            await interaction.editReply(`🔄 Pulling back user \`${userId}\`...`);
          }

          const result = await runDiscordPullback(prisma, { userId: userId || undefined });

          if (!result.ok) {
            return interaction.editReply(`❌ ${result.error}`);
          }

          if (userId && result.total === 1) {
            const u = result.targetUser;
            const label = u?.username || u?.discordId || userId;
            if (result.joined === 1) {
              return interaction.editReply(`✅ **${label}** was added to the server.`);
            }
            if (result.alreadyMember === 1) {
              return interaction.editReply(`✅ **${label}** is already in the server.`);
            }
            if (result.expired === 1) {
              return interaction.editReply(
                `❌ **${label}** has expired or missing OAuth tokens. They must sign in to OpenSteam again.`
              );
            }
            if (result.failed === 1 && result.failureSamples[0]) {
              return interaction.editReply(`❌ Failed to pull back **${label}**: ${result.failureSamples[0]}`);
            }
            if (result.failed >= 1) {
              return interaction.editReply(`❌ Failed to pull back **${label}**.`);
            }
          }

          if (!userId) {
            await interaction.editReply(
              `🔄 Found ${result.total} users with tokens. Starting pullback process...`
            );
          }

          const lines = [
            '✅ **Pullback Complete**',
            `- **Total processed**: ${result.total}`,
            `- **Newly joined**: ${result.joined}`,
            `- **Already in server**: ${result.alreadyMember}`,
            `- **Expired / no token**: ${result.expired}`,
            `- **Other failures**: ${result.failed}`,
          ];

          if (result.failureSamples.length > 0) {
            lines.push('', '**Sample failures:**', ...result.failureSamples.map((s) => `- ${s}`));
          }

          await interaction.editReply(lines.join('\n'));
        } catch (e) {
          console.error('[Pullback Error]', e);
          await interaction.editReply('❌ An error occurred during the pullback process.');
        }
      }

      if (sub === 'merge') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const targetRoleId = '1493956344925917184';
          const verifyCfg = await getVerifyConfig();
          const assignRoleId = verifyCfg.verifiedRoleId;

          // Fetch all guild members
          const members = await interaction.guild.members.fetch();

          const eligibleTargets = [];
          const alreadyMerged = [];
          const excludedOtherRoles = [];
          const excludedNonBot = [];

          for (const [memberId, member] of members) {
            const hasTargetRole = member.roles.cache.has(targetRoleId);
            if (!hasTargetRole) continue;

            const isBot = member.user.bot;
            
            // Get all other roles, excluding @everyone (which has the guild's ID) and the target role
            const otherRoles = member.roles.cache.filter(role => role.id !== interaction.guild.id && role.id !== targetRoleId);

            if (!isBot) {
              excludedNonBot.push(member);
              continue;
            }

            if (otherRoles.size === 0) {
              // Only targetRoleId and @everyone
              eligibleTargets.push(member);
            } else if (otherRoles.size === 1 && otherRoles.has(assignRoleId)) {
              // targetRoleId, assignRoleId and @everyone
              alreadyMerged.push(member);
            } else {
              // Has other roles as well
              excludedOtherRoles.push(member);
            }
          }

          const statsText = `📊 **Detection Statistics:**\n- Eligible Bots (Need Merge): **${eligibleTargets.length}**\n- Already Merged Bots: **${alreadyMerged.length}**\n- Excluded Bots (Has other roles): **${excludedOtherRoles.length}**\n- Excluded Non-Bots (With target role): **${excludedNonBot.length}**`;

          if (eligibleTargets.length === 0) {
            return interaction.editReply(`ℹ️ **Merge Check Complete**\nNo eligible bots found who require merging.\n\n${statsText}`);
          }

          await interaction.editReply(`🔄 Found **${eligibleTargets.length}** eligible bots. Assigning role <@&${assignRoleId}>...\n\n${statsText}`);

          let success = 0;
          let failed = 0;
          const processedTags = [];

          for (const member of eligibleTargets) {
            try {
              // 1. Add the new role
              await member.roles.add(assignRoleId, `Admin Merge command execution by ${interaction.user.tag}`);
              
              // 2. Remove the old role
              await member.roles.remove(targetRoleId, `Admin Merge old role cleanup by ${interaction.user.tag}`);
              
              success++;
              processedTags.push(`${member.user.tag} (${member.id})`);
            } catch (err) {
              console.error(`[Admin Merge] Failed to update roles for ${member.id}:`, err.message);
              failed++;
            }
            // Small delay to prevent hitting rate limits
            await new Promise(r => setTimeout(r, 50));
          }

          let responseText = `✅ **Merge Process Complete**\n\n${statsText}\n- **Successfully Merged**: **${success}**\n- **Failed to Update**: **${failed}**`;
          if (processedTags.length > 0) {
            const listLimit = 15;
            const shownList = processedTags.slice(0, listLimit).join('\n');
            const remaining = processedTags.length - listLimit;
            responseText += `\n\n**Newly Merged Bots:**\n${shownList}`;
            if (remaining > 0) {
              responseText += `\n*...and ${remaining} more*`;
            }
          }

          await interaction.editReply(responseText);

        } catch (e) {
          console.error('[Admin Merge Error]', e);
          await interaction.editReply(`❌ An error occurred during the merge process: ${e.message}`);
        }
      }
    }

    if (interaction.commandName === 'request') {
      const appId = interaction.options.getString('appid');
      const comment = interaction.options.getString('comment') || '';
      const REQUESTS_CHANNEL_ID = '1484100666023477308';

      const user = await getOrSyncUser(interaction.user);
      if (!user) {
        return accountNotLinkedReply(interaction);
      }

      const requestGate = await assertGenCommandAccess(interaction, user);
      if (requestGate) return requestGate;

      await interaction.deferReply();

      try {
        const gameInfo = await getCachedSteamInfo(appId);
        const gameName = gameInfo?.name || `App ${appId}`;
        const steamUrl = appId ? `https://store.steampowered.com/app/${appId}` : null;

        const existingManifest = await prisma.manifest.findUnique({
          where: { steamAppId: String(appId) },
          select: { steamAppId: true, name: true },
        });
        if (existingManifest) {
          return interaction.editReply(
            `❌ **Already Available**: **${existingManifest.name}** (App ID \`${existingManifest.steamAppId}\`) is already in our library.`
          );
        }

        // Create the request in DB
        const newRequest = await prisma.gameRequest.create({
          data: {
            appId,
            name: gameName,
            userId: user.id,
            status: 'PENDING',
            reason: `[Discord] ${comment}`
          }
        });

        // Send confirmation to user
        const embed = new EmbedBuilder()
          .setTitle('📫 Request Submitted')
          .setDescription(`Your request for **${gameName}** has been sent to our indexing team. You'll be notified when it's added.`)
          .setColor(0x6366f1)
          .addFields({ name: 'App ID', value: `\`${appId}\``, inline: true })
          .setThumbnail(gameInfo?.header_image || null)
          .setTimestamp()
          .setFooter({ text: 'OpenSteam Request Pipeline' });

        await interaction.editReply({ embeds: [embed] });

        // Send the rich embed to the management channel
        const mgmtChannel = await client.channels.fetch(REQUESTS_CHANNEL_ID);
        if (mgmtChannel) {
          const mgmtEmbed = new EmbedBuilder()
            .setTitle(`🎮 New Game Request · ${gameName}`)
            .setURL(steamUrl)
            .setDescription(
              gameInfo?.short_description?.slice(0, 320) || comment || 'No additional details provided.',
            )
            .setColor(0x6366f1)
            .addFields(
              { name: 'App ID', value: appId ? `\`${appId}\`` : 'N/A', inline: true },
              { name: 'Requester', value: `<@${user.discordId}>`, inline: true },
              { name: 'Status', value: '⏳ **PENDING**', inline: true }
            )
            .setThumbnail(gameInfo?.header_image || null)
            .setTimestamp()
            .setFooter({ text: 'OpenSteam Request Pipeline' });

          const sentMsg = await mgmtChannel.send({
            content: `📫 **New Request** from <@${user.discordId}>`,
            embeds: [mgmtEmbed]
          });

          // Store the message ID for status updates
          await prisma.gameRequest.update({
            where: { id: newRequest.id },
            data: {
              discordMessageId: sentMsg.id,
              discordChannelId: REQUESTS_CHANNEL_ID
            }
          });
        }
      } catch (e) {
        console.error('[Bot Request Error]', e);
        await interaction.editReply('❌ Error submitting request.');
      }
    }

    if (interaction.commandName === 'autogen') {
      const operatorUser = await prisma.user.findUnique({
        where: { discordId: interaction.user.id }
      });

      if (!operatorUser || !['ADMIN', 'OWNER'].includes(operatorUser.role)) {
        return interaction.reply({
          content: 'Access denied: only OpenSteam Admin or Owner accounts can run autogen.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const action = interaction.options.getString('action') || 'run';
      const modeAtStart = await getAutogenMode();
      const maxLimit = modeAtStart === 'depotbox'
        ? 120
        : modeAtStart === 'upstream'
          ? 100
          : 25;
      const requestedLimit = interaction.options.getInteger('limit') || (
        modeAtStart === 'depotbox'
          ? 120
          : modeAtStart === 'upstream'
            ? 10
            : 10
      );
      const limit = Math.max(1, Math.min(maxLimit, requestedLimit));
      const requestId = interaction.options.getString('request_id')?.trim() || null;

      await interaction.deferReply();

      if (action === 'enable' || action === 'enable_depotbox' || action === 'enable_upstream' || action === 'enable_heavygen' || action === 'disable') {
        if (action === 'disable') {
          await setBotConfigValue('AUTOGEN_ENABLED', 'false');
          await setBotConfigValue('AUTOGEN_HEAVYGEN_ENABLED', 'false');
          const mode = await getAutogenMode();
          return interaction.editReply({ embeds: [buildAutogenToggleEmbed(false, mode)] });
        }

        if (action === 'enable_heavygen') {
          await setBotConfigValue('AUTOGEN_HEAVYGEN_ENABLED', 'true');
          await setBotConfigValue('AUTOGEN_HEAVYGEN_NEXT_RUN_AT', new Date(Date.now() + 10_000).toISOString());
          return interaction.editReply({ embeds: [buildAutogenToggleEmbed(true, 'heavygen')] });
        }

        if (action === 'enable_upstream') {
          await setBotConfigValue('AUTOGEN_ENABLED', 'true');
          await setBotConfigValue('AUTOGEN_MODE', 'upstream');
          await setBotConfigValue('AUTOGEN_PROVIDER_ORDER', 'ryuu,morrenus');
          await initializeUpstreamAutogenSchedule();
          return interaction.editReply({ embeds: [buildAutogenToggleEmbed(true, 'upstream')] });
        }

        const mode = action === 'enable_depotbox' ? 'depotbox' : 'requests';
        await setBotConfigValue('AUTOGEN_ENABLED', 'true');
        await setBotConfigValue('AUTOGEN_MODE', mode);
        if (mode === 'depotbox') {
          await initializeDepotBoxAutogenSchedule();
        }
        return interaction.editReply({ embeds: [buildAutogenToggleEmbed(true, mode)] });
      }

      if (action === 'status') {
        const mode = await getAutogenMode();
        const [enabled, dailyLimit, lastRunRaw, pendingCount, hasProviderKey] = await Promise.all([
          isAutogenEnabled(),
          getAutogenDailyLimit(mode),
          getBotConfigValue('AUTOGEN_LAST_RUN_AT', false),
          prisma.gameRequest.count({ where: { status: 'PENDING' } }),
          hasAutogenProviderKey(mode),
        ]);

        let depotboxStatus = null;
        let upstreamStatus = null;
        if (mode === 'depotbox') {
          const [dayState, nextRunRaw, spreadHours, spacingMs] = await Promise.all([
            syncDepotBoxDayState(),
            getBotConfigValue('AUTOGEN_DEPOTBOX_NEXT_RUN_AT', false),
            getDepotBoxSpreadHours(),
            computeDepotBoxTickSpacingMs(dailyLimit),
          ]);
          depotboxStatus = {
            dayCount: dayState.count,
            remaining: dayState.remaining,
            nextRunRaw,
            spreadHours,
            spacingMinutes: Math.round(spacingMs / 60_000),
          };
        }
        if (mode === 'upstream') {
          const [dayState, nextRunRaw, spreadHours, spacingMs] = await Promise.all([
            syncUpstreamDayState(),
            getBotConfigValue('AUTOGEN_UPSTREAM_NEXT_RUN_AT', false),
            getUpstreamSpreadHours(),
            computeUpstreamTickSpacingMs(dailyLimit),
          ]);
          upstreamStatus = {
            dayCount: dayState.count,
            remaining: dayState.remaining,
            nextRunRaw,
            spreadHours,
            spacingMinutes: Math.round(spacingMs / 60_000),
          };
        }
        
        const heavygenEnabled = await isHeavygenEnabled();
        let heavygenStatusObj = null;
        if (heavygenEnabled) {
          const [dayState, nextRunRaw] = await Promise.all([
            syncHeavygenDayState(),
            getBotConfigValue('AUTOGEN_HEAVYGEN_NEXT_RUN_AT', false)
          ]);
          heavygenStatusObj = {
            dayCount: dayState.count,
            remaining: dayState.remaining,
            nextRunRaw,
            spreadHours: 24,
            spacingMinutes: Math.round(((24 * 60 * 60 * 1000) / Math.max(1, dayState.dailyLimit)) / 60_000)
          };
        }

        return interaction.editReply({
          embeds: [
            buildAutogenStatusEmbed({
              enabled,
              mode,
              dailyLimit,
              pendingCount,
              lastRunRaw,
              hasProviderKey,
              running: autogenRunning || depotBoxAutogenTickRunning || upstreamAutogenTickRunning || heavygenTickRunning,
              depotboxStatus,
              upstreamStatus,
              heavygenStatus: heavygenStatusObj,
            }),
          ],
        });
      }

      if (autogenRunning || depotBoxAutogenTickRunning || upstreamAutogenTickRunning || heavygenTickRunning) {
        return interaction.editReply({
          embeds: [buildAutogenInfoEmbed('Autogen Busy', 'Autogen is already running. Wait for the current batch to finish.', 0xf59e0b)],
        });
      }

      autogenRunning = true;

      try {
        const mode = await getAutogenMode();

        if (!(await hasAutogenProviderKey(mode))) {
          return interaction.editReply({
            embeds: [
              buildAutogenErrorEmbed(
                'Autogen Unavailable',
                mode === 'depotbox'
                  ? 'DEPOTBOX_API_KEY is not configured.'
                  : mode === 'upstream'
                    ? 'RYUU_API_KEY and/or MORRENUS_API_KEY must be configured for upstream scan mode.'
                    : 'No upstream provider key is configured (RYUU_API_KEY, MORRENUS_API_KEY, or DEPOTBOX_API_KEY).',
              ),
            ],
          });
        }

        if (mode === 'depotbox') {
          const dayState = await syncDepotBoxDayState();
          const effectiveLimit = Math.min(limit, dayState.remaining);
          if (effectiveLimit <= 0) {
            return interaction.editReply({
              embeds: [
                buildAutogenInfoEmbed(
                  'Daily Quota Reached',
                  `DepotBox autogen has already processed **${dayState.count}/${dayState.dailyLimit}** games today. The paced schedule resumes after UTC midnight or when the quota resets.`,
                  0xf59e0b,
                ),
              ],
            });
          }

          await interaction.editReply({
            embeds: [buildAutogenProgressEmbed(effectiveLimit, null, 'depotbox')],
          });

          const { batch, results } = await runDepotBoxAutogenBatch(client, operatorUser, {
            limit: effectiveLimit,
            manual: true,
            updateDayCount: true,
          });

          return interaction.editReply({
            content: null,
            embeds: formatAutogenSummary(results, batch.length, 'depotbox'),
          });
        }

        if (mode === 'upstream') {
          const dayState = await syncUpstreamDayState();
          const effectiveLimit = Math.min(limit, dayState.remaining);
          if (effectiveLimit <= 0) {
            return interaction.editReply({
              embeds: [
                buildAutogenInfoEmbed(
                  'Daily Quota Reached',
                  `Upstream autogen has already processed **${dayState.count}/${dayState.dailyLimit}** games today. The paced schedule resumes after UTC midnight or when the quota resets.`,
                  0xf59e0b,
                ),
              ],
            });
          }

          await interaction.editReply({
            embeds: [buildAutogenProgressEmbed(effectiveLimit, null, 'upstream')],
          });

          const { batch, results } = await runUpstreamAutogenBatch(client, operatorUser, {
            limit: effectiveLimit,
            manual: true,
            updateDayCount: true,
          });

          return interaction.editReply({
            content: null,
            embeds: formatAutogenSummary(results, batch.length, 'upstream'),
          });
        }

        const batch = await collectAutogenBatch(limit, requestId);

        if (batch.length === 0) {
          return interaction.editReply({
            embeds: [
              buildAutogenInfoEmbed(
                'Nothing to Process',
                requestId
                  ? `No pending request found for ID \`${requestId}\`.`
                  : 'No pending requests are waiting for autogen.',
                0x71717a,
              ),
            ],
          });
        }

        await interaction.editReply({
          embeds: [buildAutogenProgressEmbed(batch.length, requestId, 'requests')],
        });

        const { results } = await runAutogenBatch(client, operatorUser, { limit, requestId, batch });
        if (!requestId) {
          await setBotConfigValue('AUTOGEN_LAST_RUN_AT', new Date().toISOString());
        }

        await interaction.editReply({
          content: null,
          embeds: formatAutogenSummary(results, batch.length, 'requests'),
        });
      } catch (e) {
        console.error('[Autogen] Command failed:', e);
        await interaction.editReply({
          embeds: [buildAutogenErrorEmbed('Autogen Failed', e.message || 'unknown error')],
        });
      } finally {
        autogenRunning = false;
      }
    }

    if (interaction.commandName === 'ask') {
      const query = interaction.options.getString('query') || '';
      await interaction.deferReply();
      try {
        const { getKnowledgeBaseContext } = require('./lib/kb-service');
        const { callLlmForDiscord } = require('./lib/discord-ai-chat');
        const kbContext = getKnowledgeBaseContext(query);
        const llmResult = await callLlmForDiscord(query, kbContext);

        const embed = new EmbedBuilder()
          .setDescription(llmResult.content.slice(0, 4000))
          .setColor(0x6366f1)
          .setFooter({ text: `Source: ${llmResult.provider}` });

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('[Ask Command Error]', err?.message || err);
        await interaction.editReply('❌ Could not generate AI response right now. Please try again in a bit!');
      }
      return;
    }

    if (interaction.commandName === 'key') {
      const sub = interaction.options.getSubcommand()
      const { handleKeyPair, handleKeyStatus, handleKeyShow } = require('./lib/device-key-commands')
      if (sub === 'pair') {
        return handleKeyPair(interaction, prisma)
      }
      if (sub === 'status') {
        return handleKeyStatus(interaction, prisma)
      }
      if (sub === 'show') {
        return handleKeyShow(interaction, prisma)
      }
    }

    if (interaction.commandName === 'status') {
      const user = await getOrSyncUser(interaction.user);
      if (!user) {
        return accountNotLinkedReply(interaction);
      }

      await interaction.deferReply();

      try {
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(); todayEnd.setUTCHours(23, 59, 59, 999);

        const [todayCount, totalGen] = await Promise.all([
          prisma.webGeneration.count({ where: { userId: user.id, createdAt: { gte: todayStart, lte: todayEnd } } }),
          prisma.webGeneration.count({ where: { userId: user.id } })
        ]);

        const dailyLimit = getWebDailyLimit(user.plan);

        const embed = new EmbedBuilder()
          .setTitle(`👤 Account Status: ${user.username}`)
          .setColor(0x6366f1)
          .addFields(
            { name: 'Plan', value: `**${user.plan}**`, inline: true },
            { name: 'Daily Goal', value: `\`${todayCount}/${dailyLimit}\``, inline: true },
            { name: 'Total Generated', value: `${totalGen}`, inline: true },
            { name: 'Status', value: user.isBanned ? '🔴 Banned' : '🟢 Active', inline: true },
            { name: 'Join Date', value: `<t:${Math.floor(new Date(user.createdAt).getTime() / 1000)}:D>`, inline: true }
          )
          .setFooter({ text: 'OpenSteam User Profile' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (e) {
        await interaction.editReply('❌ Error fetching your status.');
      }
    }

    if (interaction.commandName === 'telegram') {
      const embed = new EmbedBuilder()
        .setTitle('📱 Join our Telegram!')
        .setDescription('Get exclusive updates, crack worlds, and generate games directly on Telegram!\n\n**[Join OpenSteam Telegram](https://t.me/+6aDkmfeYsLozYjA0)**')
        .setColor(0x0088cc);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Join Telegram')
          .setStyle(ButtonStyle.Link)
          .setURL('https://t.me/+6aDkmfeYsLozYjA0')
      );
      
      return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.commandName === 'dlcgen') {
      const parsedAppId = getGenAppIdFromInteraction(interaction);
      if (!parsedAppId.ok) {
        return interaction.reply({
          content: `Invalid App ID: ${parsedAppId.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const appId = parsedAppId.appId;

      const genConfig = await prisma.systemConfig.findUnique({ where: { key: 'GENERATION_ENABLED' } });
      if (genConfig && genConfig.value === 'false') {
        return interaction.reply({
          content: 'Generation is currently suspended for maintenance.',
          flags: MessageFlags.Ephemeral
        });
      }

      const user = await getOrSyncUser(interaction.user);
      if (!user) {
        return accountNotLinkedReply(interaction);
      }

      const dlcGate = await assertGenCommandAccess(interaction, user);
      if (dlcGate) return dlcGate;

      await interaction.deferReply();

      try {
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(); todayEnd.setUTCHours(23, 59, 59, 999);

        const todayCount = await prisma.webGeneration.count({
          where: { userId: user.id, createdAt: { gte: todayStart, lte: todayEnd } }
        });

        const dailyLimit = getWebDailyLimit(user.plan);
        if (todayCount >= dailyLimit) {
          return interaction.editReply(`Daily limit reached: you have used **${todayCount}/${dailyLimit}** generations today.`);
        }

        const gameInfo = await getCachedSteamInfo(appId);
        const gameName = gameInfo?.name || `App ${appId}`;

        await interaction.editReply(`Searching Hubcap DLC Lua for \`${appId}\`...`);

        const result = await fetchDlcLuaFromHubcap(appId);
        if (!result.success || !result.luaBuffer) {
          return interaction.editReply(`DLC Lua not found for App ID \`${appId}\`.`);
        }

        const delivery = await sendDlcLuaToRequester(interaction, {
          gameName,
          appId,
          luaBuffer: result.luaBuffer,
          sourceLabel: result.source || 'HUBCAP_DLC',
        });

        if (!delivery.sent) {
          return interaction.editReply(`DLC Lua was found for **${gameName}** (\`${appId}\`), but I could not send it (${delivery.reason || 'unknown error'}).`);
        }

        await prisma.webGeneration.create({
          data: { userId: user.id, appId, gameName: `${gameName} DLC Lua`, source: 'discord' }
        });

        await interaction.editReply(`DLC Lua generated for **${gameName}** (\`${appId}\`). Usage: **${todayCount + 1}/${dailyLimit}**.`);
      } catch (e) {
        console.error('[DLC Gen Error]', e);
        await interaction.editReply(`DLC generation failed: ${e.message || 'unknown error'}`);
      }
    }

    if (interaction.commandName === 'gen') {
      const parsedAppId = getGenAppIdFromInteraction(interaction);
      if (!parsedAppId.ok) {
        return interaction.reply({
          content: `❌ **Invalid App ID**: ${parsedAppId.message}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const appId = parsedAppId.appId;

      const genConfig = await prisma.systemConfig.findUnique({ where: { key: 'GENERATION_ENABLED' } });
      if (genConfig && genConfig.value === 'false') {
        return interaction.reply({
          content: '🔒 **Generation Locked**: Manifest generation is currently suspended for maintenance.',
          flags: MessageFlags.Ephemeral
        });
      }

      // 1. Resolve User
      const user = await getOrSyncUser(interaction.user);
      if (!user) {
        return accountNotLinkedReply(interaction);
      }

      const genGate = await assertGenCommandAccess(interaction, user);
      if (genGate) return genGate;

      await interaction.deferReply();

      try {
        // 2. Daily check
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(); todayEnd.setUTCHours(23, 59, 59, 999);

        const todayCount = await prisma.webGeneration.count({
          where: { userId: user.id, createdAt: { gte: todayStart, lte: todayEnd } }
        });

        const dailyLimit = getWebDailyLimit(user.plan);
        if (todayCount >= dailyLimit) {
          return interaction.editReply(`❌ **Daily Limit Reached**: You have used all **${todayCount}/${dailyLimit}** generations for today. Upgrade your plan to increase this limit.`);
        }

        const APP_URL = getGenAppUrl();

        // Fetch Steam Info for rich embed and better naming
        const gameInfo = await getCachedSteamInfo(appId);
        const gameName = gameInfo?.name || `App ${appId}`;

        // Check for NSFW content
        const nsfwKeywords = ['nudity', 'sexual content', 'nsfw', 'hentai', 'sexual violence'];
        const isNsfw = gameInfo?.genres?.some((g) => 
          nsfwKeywords.includes(g.description?.toLowerCase())
        ) || false;

        if (isNsfw) {
          return interaction.editReply('❌ **NSFW content is not permitted to be generated on this platform.**');
        }

        // 3. Check Cache (DB first, then Storage)
        let manifestData = await prisma.manifest.findUnique({ where: { steamAppId: appId } });
        let isFileInStorage = false;

        const s3Key = manifestData?.s3Key || `manifests/${appId}/${appId}.zip`;
        if (!manifestData && botS3Client && process.env.AWS_S3_BUCKET_NAME) {
          try {
            await botS3Client.send(new HeadObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: s3Key }));
            isFileInStorage = true;
          } catch (e) { }
        }
        if (!manifestData && !isFileInStorage) {
          const storagePath = process.env.STORAGE_PATH || path.join(__dirname, '../data');
          if (fs.existsSync(path.join(storagePath, 'manifests', appId, `${appId}.zip`))) {
            isFileInStorage = true;
          }
        }

        if (manifestData || isFileInStorage) {
          // Prefer the real Steam name over a placeholder stored in the DB.
          const dbName = manifestData?.name;
          const steamName = gameInfo?.name;
          const gameName = (steamName && (!dbName || isPlaceholderName(dbName)))
            ? steamName
            : (dbName || steamName || `App ${appId}`);
          // Passive backfill: if Steam gave us the real name and the DB still has a placeholder, persist it.
          if (steamName && dbName && isPlaceholderName(dbName)) {
            void passiveBackfillManifestName(appId, steamName);
          }
          // Track it
          await prisma.webGeneration.create({
            data: { userId: user.id, appId, gameName, source: 'discord' }
          });

          const knownSize = manifestData?.fileSize != null ? Number(manifestData.fileSize) : null;
          const loaded = await loadCachedManifestZip(appId, knownSize, manifestData?.s3Key || s3Key);
          const zipBuffer = loaded.buffer;
          const zipTooLarge = loaded.reason === 'too_large';

          if (zipTooLarge) {
            let description = gameInfo?.short_description || `**${gameName}** is already available in our high-speed storage.`;
            const embed = new EmbedBuilder()
              .setTitle('✅ Manifest Found (Cached)')
              .setDescription(description)
              .setColor(0x10b981)
              .addFields(
                { name: 'App ID', value: `\`${appId}\``, inline: true },
                { name: 'Source', value: 'Internal Cloud', inline: true }
              );

            if (gameInfo) {
              if (gameInfo.developers?.[0]) embed.addFields({ name: 'Developer', value: gameInfo.developers[0], inline: true });
              if (gameInfo.publishers?.[0]) embed.addFields({ name: 'Publisher', value: gameInfo.publishers[0], inline: true });
              if (gameInfo.header_image) embed.setThumbnail(gameInfo.header_image);
            }

            embed.setTimestamp()
              .setFooter({ text: `Usage: ${todayCount + 1}/${dailyLimit} • Generated via OpenSteam Cloud` });

            await interaction.editReply({ content: null, embeds: [embed] });
            await notifyGenZipFailure(
              interaction,
              `⚠️ **${gameName}** (\`${appId}\`) is over Discord's ${MAX_GEN_DISCORD_ZIP_LABEL} limit. Sign in at ${getGenAppUrl()} to download it.`
            );
            return;
          }

          if (zipBuffer) {
            // Clean cached zips that may predate the upload-time cleaner
            const cleanedZipBuffer = await cleanManifestZip(zipBuffer);
            let description = gameInfo?.short_description || `**${gameName}** is already available in our high-speed storage.`;
            description += '\n\n📩 _Your ZIP will arrive in a **separate private message** only you can see._';

            const embed = new EmbedBuilder()
              .setTitle('✅ Manifest Found (Cached)')
              .setDescription(description)
              .setColor(0x10b981)
              .addFields(
                { name: 'App ID', value: `\`${appId}\``, inline: true },
                { name: 'Source', value: 'Internal Cloud', inline: true }
              );

            if (gameInfo) {
              if (gameInfo.developers?.[0]) embed.addFields({ name: 'Developer', value: gameInfo.developers[0], inline: true });
              if (gameInfo.publishers?.[0]) embed.addFields({ name: 'Publisher', value: gameInfo.publishers[0], inline: true });
              if (gameInfo.header_image) embed.setThumbnail(gameInfo.header_image);
            }

            embed.setTimestamp()
              .setFooter({ text: `Usage: ${todayCount + 1}/${dailyLimit} • Generated via OpenSteam Cloud` });

            await interaction.editReply({ content: null, embeds: [embed] });

            const zipDelivery = await sendGenZipToRequester(interaction, {
              gameName,
              appId,
              zipBuffer: cleanedZipBuffer,
              sourceLabel: 'Internal Cloud',
            });

            if (!zipDelivery.sent) {
              await notifyGenZipFailure(
                interaction,
                `⚠️ Could not send your ZIP (${zipDelivery.reason || 'unknown error'}). Enable DMs from server members or download via ${getSiteHostLabel()}.`
              );
            }
            return;
          }
          // If zipBuffer is null (missing on local container disk/S3), fall through to upstream fetch below!
        }

        // 4. Fetch upstream, persist to storage, then deliver ZIP + web download instructions
        await interaction.editReply(`⏳ **Searching...**\nChecking upstream providers for App ID \`${appId}\`...`);

        const result = await fetchExternalManifest(appId);
        if (!result.success) {
          return interaction.editReply(`❌ **Game Not Found**: App ID \`${appId}\` was not found in our storage or any upstream provider.`);
        }

        // Track usage
        await prisma.webGeneration.create({
          data: { userId: user.id, appId, gameName, source: 'discord' }
        });

        try {
          const registerResult = await registerAutogenManifestLocally(client, {
            appId,
            gameName,
            zipBuffer: result.zipBuffer,
          });
          if (!registerResult.ok) {
            console.warn('[Bot Gen] Failed to persist manifest:', registerResult.error);
          }
        } catch (e) {
          console.warn('[Bot Gen] Failed to persist manifest to storage:', e.message);
        }

        const zipTooLarge = result.zipBuffer.length > MAX_GEN_DISCORD_ZIP;

        let extDescription = gameInfo?.short_description || `**${gameName}** was found via an upstream provider.`;
        if (!zipTooLarge) {
          extDescription += '\n\n📩 _Your ZIP will arrive in a **separate private message** only you can see._';
        }

        const embed = new EmbedBuilder()
          .setTitle('✅ Manifest Found')
          .setDescription(extDescription)
          .setColor(0x6366f1)
          .addFields(
            { name: 'App ID', value: `\`${appId}\``, inline: true },
            { name: 'Source', value: result.source || 'External', inline: true },
            ...buildGenDeliveryFields({
              gameName,
              appId,
              zipDelivered: false,
              zipTooLarge,
              zipVia: null,
            })
          );

        if (gameInfo) {
          if (gameInfo.developers?.[0]) embed.addFields({ name: 'Developer', value: gameInfo.developers[0], inline: true });
          if (gameInfo.publishers?.[0]) embed.addFields({ name: 'Publisher', value: gameInfo.publishers[0], inline: true });
          if (gameInfo.header_image) embed.setThumbnail(gameInfo.header_image);
        }

        embed.setTimestamp()
          .setFooter({ text: `Usage: ${todayCount + 1}/${dailyLimit}` });

        await interaction.editReply({ content: null, embeds: [embed] });

        let zipDelivery = { sent: false };
        if (!zipTooLarge) {
          zipDelivery = await sendGenZipToRequester(interaction, {
            gameName,
            appId,
            zipBuffer: result.zipBuffer,
            sourceLabel: result.source || 'External',
          });
        } else {
          await notifyGenZipFailure(
            interaction,
            `⚠️ **${gameName}** (\`${appId}\`) is over Discord's ${MAX_GEN_DISCORD_ZIP_LABEL} limit. Sign in at ${getGenAppUrl()} to download it.`
          );
        }

        if (!zipTooLarge && !zipDelivery.sent) {
          await notifyGenZipFailure(
            interaction,
            `⚠️ Could not send your ZIP (${zipDelivery.reason || 'unknown error'}). Enable DMs from server members or download via ${getSiteHostLabel()}.`
          );
        }

        await sendSystemAlert(client, `📦 **Manifest Served (External)**\n**Game**: ${gameName}\n**App ID**: ${appId}\n**User**: ${user.username} (${user.id})\n**Source**: ${result.source || 'External'}`);

      } catch (e) {
        console.error('Discord Gen Error:', e);
        await interaction.editReply('❌ **System Error**: An unexpected error occurred while processing your request.');
      }
    }
    if (interaction.commandName === 'dm-warn') {
      const adminUser = await checkAdmin(interaction);
      if (!adminUser) return;

      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      if (!targetUser) {
        return interaction.reply({ content: '❌ **Error**: Could not resolve the target user.', flags: MessageFlags.Ephemeral });
      }

      if (targetUser.bot) {
        return interaction.reply({ content: '❌ **Error**: You cannot DM a warning to a bot.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let dmSent = true;
      try {
        const warnEmbed = new EmbedBuilder()
          .setTitle('⚠️ OpenSteam Warning')
          .setDescription(`Hey <@${targetUser.id}>,\n\nThis is an official warning from the **OpenSteam** staff team. The following is **not permitted** within OpenSteam:\n\n> ${reason}\n\nPlease stop immediately. Continued violations may lead to formal warnings, timeouts, or a ban from the platform and community.`)
          .setColor(0xf59e0b)
          .setTimestamp()
          .setFooter({ text: 'OpenSteam Moderation Team' });

        await sendUserDirectMessage(targetUser, { content: `<@${targetUser.id}>`, embeds: [warnEmbed] });
      } catch (dmErr) {
        dmSent = false;
        console.warn('[dm-warn] Could not DM user:', dmErr.message);
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle(dmSent ? '✅ Warning DM Sent' : '🔴 Warning DM Failed')
        .setDescription(`**Target**: ${targetUser.tag} (<@${targetUser.id}>)\n**Reason**: ${reason}\n**Delivery**: ${dmSent ? '🟢 Delivered' : '🔴 Failed (user has DMs off or blocked the bot)'}`)
        .setColor(dmSent ? 0xf59e0b : 0xef4444)
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed] });
    }

    if (interaction.commandName === 'self-adv') {
      const adminUser = await checkAdmin(interaction);
      if (!adminUser) return;

      const messageContent = interaction.options.getString('message');

      await interaction.reply({ content: '⏳ Gathering user list and starting broadcast...', flags: MessageFlags.Ephemeral });

      let allDiscordIds = new Set();

      // 1. Get all registered members from DB
      try {
        const registeredUsers = await prisma.user.findMany({ select: { discordId: true } });
        for (const u of registeredUsers) {
          if (u.discordId) allDiscordIds.add(u.discordId);
        }
      } catch (e) {
        console.error('[self-adv] Failed to fetch DB users:', e);
      }

      // 2. Get all members from the guild where the command was executed
      if (interaction.guild) {
        try {
          const members = await interaction.guild.members.fetch();
          for (const [id, member] of members) {
            if (!member.user.bot) {
              allDiscordIds.add(id);
            }
          }
        } catch (e) {
          console.error('[self-adv] Failed to fetch guild members:', e);
        }
      }

      const targetIds = Array.from(allDiscordIds);

      if (targetIds.length === 0) {
        return interaction.editReply({ content: '❌ No valid targets found.' });
      }

      await interaction.editReply(`🚀 Broadcasting to ${targetIds.length} users. This may take some time depending on rate limits.`);

      let successCount = 0;
      let failCount = 0;

      // Broadcast asynchronously to not block the daemon
      (async () => {
        for (const id of targetIds) {
          try {
            const discUser = await client.users.fetch(id);
            const advEmbed = new EmbedBuilder()
              .setTitle('📣 Important Update / Announcement')
              .setDescription(messageContent)
              .setColor(0x3b82f6)
              .setTimestamp()
              .setFooter({ text: 'OpenSteam Network Broadcast' });

            await sendUserDirectMessage(discUser, { embeds: [advEmbed] });
            successCount++;
          } catch (e) {
            failCount++;
          }
          // Small delay to prevent hitting rate limits too aggressively (Discord limits DMs)
          await new Promise(res => setTimeout(res, 300));
        }

        try {
          await interaction.followUp({ content: `✅ **self-adv broadcast completed!**\nDelivered: ${successCount}\nFailed: ${failCount}`, flags: MessageFlags.Ephemeral });
        } catch (e) { }
      })();
    }

    if (interaction.commandName === 'drop') {
      const adminUser = await checkAdmin(interaction);
      if (!adminUser) return;

      const count = interaction.options.getInteger('count') || 1;
      const platform = interaction.options.getString('platform');
      const minGames = interaction.options.getInteger('min_games') || 0;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const { executeAccountDrop } = require('./lib/drop-logic.js');
        const result = await executeAccountDrop(count, interaction.user.id, prisma, minGames, platform);

        if (result.success) {
          await interaction.editReply(`✅ ${result.message}`);
        } else {
          await interaction.editReply(`❌ ${result.message}`);
        }
      } catch (e) {
        console.error('[Drop Error]', e);
        await interaction.editReply(`❌ Error executing drop: ${e.message}`);
      }
    }

    // --- Economy & Fun Suite Slash Commands ---
    if (interaction.commandName === 'coins') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const dbUser = await getOrSyncUser(targetUser);

      if (!dbUser) return interaction.editReply('❌ Failed to fetch/sync economy profile.');

      const embed = new EmbedBuilder()
        .setTitle(`💰 OpenSteam Coin Balance`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setColor(0xf59e0b)
        .addFields(
          { name: 'User', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Balance', value: `✨ **${dbUser.coins.toLocaleString()}** OpenSteam Coins`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Earn coins by chat activity or winning trivia games!' });

      await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'daily') {
      await interaction.deferReply();
      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      // Prevent duplicate daily claim using persistent AuditLog
      const lastClaim = await prisma.auditLog.findFirst({
        where: {
          userId: dbUser.id,
          action: 'CLAIM_DAILY',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      });

      if (lastClaim) {
        const nextClaimTime = new Date(lastClaim.createdAt.getTime() + 24 * 60 * 60 * 1000);
        return interaction.editReply(`❌ You have already claimed your daily reward!\nYou can claim it again in <t:${Math.floor(nextClaimTime.getTime() / 1000)}:R>.`);
      }

      const reward = Math.floor(Math.random() * 201) + 100; // 100 - 300 coins
      await incrementCoinsSafe(dbUser.id, reward);

      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'CLAIM_DAILY',
          details: `Claimed daily reward of ${reward} coins.`,
          ip: 'DiscordBot'
        }
      });

      const embed = new EmbedBuilder()
        .setTitle('🎉 Daily Reward Claimed!')
        .setDescription(`You have successfully claimed your daily reward of ✨ **${reward} OpenSteam Coins**!\nYour new balance is **${(dbUser.coins + reward).toLocaleString()}** coins.`)
        .setColor(0x10b981)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'shop') {
      const dbUser = await getOrSyncUser(interaction.user);
      const embed = new EmbedBuilder()
        .setTitle('🛒 OpenSteam Sentinel Cosmetic Perk Shop')
        .setDescription(`Redeem your OpenSteam Coins for cosmetic server privileges and community perks.\nUse \`/buy <item> [value] [target]\` to purchase.\n\nYour Balance: ✨ **${formatCoins(dbUser?.coins || 0)} Coins**`)
        .setColor(0x8b5cf6)
        .addFields(shopEmbedFields())
        .setFooter({ text: 'All purchases are log-tracked and moderate-safe.' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'buy') {
      await interaction.deferReply();
      const item = interaction.options.getString('item');
      const value = (interaction.options.getString('value') || '').trim();
      const targetUser = interaction.options.getUser('target');

      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      const shopItem = getShopItem(item);
      if (!shopItem) {
        return interaction.editReply('❌ Unknown shop item. Use `/shop` to view the current catalog.');
      }

      const cost = shopItem.cost;

      if (dbUser.coins < cost) {
        return interaction.editReply(`❌ Insufficient balance! You need **${formatCoins(cost)} coins** but only have **${formatCoins(dbUser.coins)}**.`);
      }

      if (shopItem.requiresValue && !value) {
        return interaction.editReply(`❌ You must provide ${shopItem.valueDescription || 'a value'} for **${shopItem.title}**.`);
      }
      if (value && shopItem.maxValueLength && value.length > shopItem.maxValueLength) {
        return interaction.editReply(`❌ The value for **${shopItem.title}** must be ${shopItem.maxValueLength} characters or fewer.`);
      }
      if (value) {
        const safety = validateShopTextValue(item, value);
        if (!safety.ok) {
          return interaction.editReply(`❌ That text cannot be used for **${shopItem.title}** because it looks like ${safety.reason}. Please choose something friendly.`);
        }
      }
      if (shopItem.requiresTarget && !targetUser) {
        return interaction.editReply(`❌ You must specify ${shopItem.targetDescription || 'a target user'} for **${shopItem.title}**.`);
      }

      const guild = interaction.guild;
      if (!guild || !interaction.channel) {
        return interaction.editReply('❌ Shop purchases can only be used inside the Discord server.');
      }

      const member = await guild.members.fetch(interaction.user.id).catch(() => null);

      if (item === 'nickname') {
        if (!member) return interaction.editReply('❌ Could not find your member profile in the server.');
        const oldNick = member.nickname || interaction.user.username;
        try {
          await member.setNickname(value, 'Purchased Self Nickname Perk');
          setTimeout(async () => {
            const currentMember = await guild.members.fetch(interaction.user.id).catch(() => null);
            if (currentMember) await currentMember.setNickname(oldNick, 'Resetting Purchased Self Nickname').catch(() => { });
          }, 3600000); // 1 hour
        } catch (e) {
          return interaction.editReply('❌ Failed to set nickname. The bot might not have permissions to modify your nickname.');
        }
      }

      else if (item === 'heckle') {
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) return interaction.editReply('❌ Target user is not in the server.');
        const protectedReason = await getProtectedModerationReason(prisma, targetUser, targetMember, { action: 'heckle' });
        if (protectedReason) {
          return interaction.editReply(`❌ ${protectedReason}`);
        }
        const oldNick = targetMember.nickname || targetUser.username;
        try {
          await targetMember.setNickname(value, `Heckled by ${interaction.user.tag}`);
          setTimeout(async () => {
            const currentTarget = await guild.members.fetch(targetUser.id).catch(() => null);
            if (currentTarget) await currentTarget.setNickname(oldNick, 'Resetting Heckled Nickname').catch(() => { });
          }, 3600000); // 1 hour
        } catch (e) {
          return interaction.editReply('❌ Failed to heckle target. The bot does not have permissions to modify their nickname.');
        }
      }

      else if (item === 'color') {
        if (!member) return interaction.editReply('❌ Could not find your member profile.');
        const hexRegex = /^#([0-9a-f]{3}){1,2}$/i;
        if (!hexRegex.test(value)) {
          return interaction.editReply('❌ Invalid Hex Color Code! Must be formatted like `#FF0055`.');
        }
        try {
          const role = await assignVisibleShopColorRole(
            guild,
            member,
            value,
            interaction.user.tag || interaction.user.username
          );

          setTimeout(async () => {
            const freshMember = await guild.members.fetch(interaction.user.id).catch(() => null);
            const targetRole = guild.roles.cache.get(role.id);
            if (freshMember?.roles.cache.has(role.id)) {
              await freshMember.roles.remove(role, 'Custom Color Role duration expired').catch(() => {});
            }
            if (targetRole && targetRole.members.cache.size === 0) {
              await targetRole.delete('Custom Color Role duration expired').catch(() => {});
            }
          }, 86400000); // 24 hours
        } catch (e) {
          if (e?.message === 'MEMBER_ROLE_ABOVE_BOT') {
            return interaction.editReply('❌ Your server roles are above the bot, so a custom color role cannot be placed high enough to show. Ask staff to raise the bot role.');
          }
          if (e?.message === 'BOT_ROLE_TOO_LOW') {
            return interaction.editReply('❌ The bot cannot manage role positions right now. Ask staff to fix role hierarchy.');
          }
          console.error('[Economy] color role purchase failed:', e);
          return interaction.editReply('❌ Failed to create or assign color role.');
        }
      }

      else if (item === 'shoutout') {
        const embed = new EmbedBuilder()
          .setTitle('📣 Broadcast Shoutout!')
          .setDescription(`📣 <@${interaction.user.id}> sends a warm shoutout to the server:\n\n💬 "${value}"`)
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setColor(0x3b82f6)
          .setTimestamp();
        await interaction.channel.send({ embeds: [embed] });
      }

      else if (item === 'spotlight') {
        const spotlightUser = targetUser || interaction.user;
        const spotlightMember = await guild.members.fetch(spotlightUser.id).catch(() => null);
        const displayName = spotlightMember?.displayName || spotlightUser.username;
        const note = value || 'A OpenSteam community spotlight has been purchased for this member.';
        const embed = new EmbedBuilder()
          .setTitle('🌟 Community Spotlight')
          .setDescription(`**${displayName}** is in the spotlight!\n\n${note}`)
          .setThumbnail(spotlightUser.displayAvatarURL({ dynamic: true }))
          .setColor(0xf59e0b)
          .setFooter({ text: `Purchased by ${interaction.user.tag}` })
          .setTimestamp();
        await interaction.channel.send({ embeds: [embed] });
      }

      else if (item === 'coinrain') {
        const embed = new EmbedBuilder()
          .setTitle('🎁 Coin Rain Pouch')
          .setDescription(`<@${interaction.user.id}> bought a public coin pouch!\n\nFirst member to press the button claims **${formatCoins(SHOP_COINRAIN_AMOUNT)} OpenSteam Coins**.`)
          .setColor(0x10b981)
          .setTimestamp();
        const claimButton = new ButtonBuilder()
          .setCustomId(`claim_coin_drop_${SHOP_COINRAIN_AMOUNT}`)
          .setLabel(`Claim ${formatCoins(SHOP_COINRAIN_AMOUNT)} Coins`)
          .setStyle(ButtonStyle.Success);
        await interaction.channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(claimButton)],
        });
      }

      else if (item === 'thread') {
        if (!interaction.channel.threads?.create) {
          return interaction.editReply('❌ This channel does not support thread creation.');
        }
        const threadName = value.replace(/\s+/g, ' ').trim();
        if (threadName.length < 2) {
          return interaction.editReply('❌ Thread name must be at least 2 characters.');
        }
        const thread = await interaction.channel.threads.create({
          name: threadName,
          autoArchiveDuration: 1440,
          reason: `Shop thread purchased by ${interaction.user.tag}`,
        });
        await thread.members.add(interaction.user.id).catch(() => {});
        await thread.send(`Thread opened by <@${interaction.user.id}> via the OpenSteam shop.`).catch(() => {});
      }

      else if (item === 'timeout') {
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) return interaction.editReply('❌ Target user is not in the server.');
        const protectedReason = await getProtectedShopTargetReason(targetUser, targetMember);
        if (protectedReason) {
            return interaction.editReply(`❌ ${protectedReason}`);
        }
        try {
          await targetMember.timeout(5 * 60 * 1000, `Purchased Timeout Perk by ${interaction.user.tag}`);
        } catch (e) {
          return interaction.editReply('❌ Failed to timeout target. The bot might not have permissions (they might have a higher role).');
        }
      }

      else if (item === 'pin') {
        try {
          const msgToPin = await interaction.channel.messages.fetch(value);
          if (!msgToPin) return interaction.editReply('❌ Message not found in this channel.');
          await msgToPin.pin(`Purchased Pin Perk by ${interaction.user.tag}`);
        } catch (e) {
          return interaction.editReply('❌ Failed to pin message. Make sure the value is a valid message ID in this channel.');
        }
      }

      else {
        return interaction.editReply('❌ This shop item is not available yet.');
      }

      // Deduct coins & Log
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { coins: { decrement: cost } }
      });

      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'BUY_PERK',
          details: `Purchased shop item ${item} for ${cost} coins. Value: ${value || '(none)'} Target: ${targetUser?.id || '(none)'}`,
          ip: 'DiscordBot'
        }
      });

      await interaction.editReply(`✅ Successfully purchased **${shopItem.title}** for **${formatCoins(cost)} coins**! Enjoy your server perk! ✨`);
    }

    if (interaction.commandName === 'work') {
      await interaction.deferReply();
      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      const lastWork = await prisma.auditLog.findFirst({
        where: {
          userId: dbUser.id,
          action: 'ECONOMY_WORK',
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } // 1 hour
        }
      });

      if (lastWork) {
        const nextTime = new Date(lastWork.createdAt.getTime() + 60 * 60 * 1000);
        return interaction.editReply(`❌ You are too tired to work right now!\nYou can work again in <t:${Math.floor(nextTime.getTime() / 1000)}:R>.`);
      }

      const reward = Math.floor(Math.random() * 101) + 50; // 50 to 150
      const jobs = [
        'cleaned the Steam servers', 'debugged some manifest code', 'moderated the Discord chat',
        'designed a new shop item', 'mined some crypto', 'found a bug and reported it',
        'helped a new user', 'wrote a tutorial'
      ];
      const job = jobs[Math.floor(Math.random() * jobs.length)];

      await incrementCoinsSafe(dbUser.id, reward);

      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'ECONOMY_WORK',
          details: `Worked and earned ${reward} coins.`,
          ip: 'DiscordBot'
        }
      });

      const embed = new EmbedBuilder()
        .setTitle('💼 Hard Work Pays Off!')
        .setDescription(`You **${job}** and earned ✨ **${reward} OpenSteam Coins**!\n\nYour new balance is **${(dbUser.coins + reward).toLocaleString()}** coins.`)
        .setColor(0x10b981)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'weekly') {
      await interaction.deferReply();
      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      const lastClaim = await prisma.auditLog.findFirst({
        where: {
          userId: dbUser.id,
          action: 'CLAIM_WEEKLY',
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      });

      if (lastClaim) {
        const nextClaimTime = new Date(lastClaim.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        return interaction.editReply(`❌ You have already claimed your weekly reward!\nYou can claim it again in <t:${Math.floor(nextClaimTime.getTime() / 1000)}:R>.`);
      }

      const reward = Math.floor(Math.random() * 2001) + 1000; // 1000 - 3000 coins
      await incrementCoinsSafe(dbUser.id, reward);

      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'CLAIM_WEEKLY',
          details: `Claimed weekly reward of ${reward} coins.`,
          ip: 'DiscordBot'
        }
      });

      const embed = new EmbedBuilder()
        .setTitle('🗓️ Weekly Reward Claimed!')
        .setDescription(`You have successfully claimed your huge weekly reward of ✨ **${reward} OpenSteam Coins**!\nYour new balance is **${(dbUser.coins + reward).toLocaleString()}** coins.`)
        .setColor(0x3b82f6)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'rob') {
      try {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('user');
        if (!targetUser) {
          return interaction.editReply('❌ Could not resolve the user to rob.');
        }

        const dbUser = await getOrSyncUser(interaction.user);
        const dbTarget = await getOrSyncUser(targetUser);

        if (!dbUser || !dbTarget) return interaction.editReply('❌ Failed to sync profiles.');

        if (dbUser.id === dbTarget.id) {
          return interaction.editReply('❌ You cannot rob yourself, that\'s just moving coins from one pocket to another.');
        }

        if (dbTarget.role === 'OWNER') {
          return interaction.editReply('❌ You cannot rob the **Owner** — they are protected by the economy safeguards.');
        }

        // Check cooldown (12 hours)
        const lastRob = await prisma.auditLog.findFirst({
          where: {
            userId: dbUser.id,
            action: 'ECONOMY_ROB',
            createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
          }
        });

        if (lastRob) {
          const nextTime = new Date(lastRob.createdAt.getTime() + 12 * 60 * 60 * 1000);
          return interaction.editReply(`❌ The cops are still looking for you! Lay low.\nYou can rob again in <t:${Math.floor(nextTime.getTime() / 1000)}:R>.`);
        }

        // Need at least 250 coins to rob someone (to pay the fine if caught)
        if ((dbUser.coins ?? 0) < 250) {
          return interaction.editReply('❌ You need at least **250 coins** to attempt a robbery (in case you get caught and fined).');
        }

        if ((dbTarget.coins ?? 0) < 100) {
          return interaction.editReply(`❌ <@${targetUser.id}> is too poor to rob. They don't even have 100 coins! Have some mercy.`);
        }

        const targetLabel = targetUser.username || targetUser.globalName || targetUser.id;

        // Log the attempt to enforce cooldown
        await prisma.auditLog.create({
          data: {
            userId: dbUser.id,
            action: 'ECONOMY_ROB',
            details: { targetDiscordId: targetUser.id, targetLabel },
            ip: 'DiscordBot'
          }
        });

        // 40% success rate
        const success = Math.random() < 0.4;

        if (success) {
          // Steal between 5% and 15% of target's wealth
          const stealPercent = (Math.floor(Math.random() * 11) + 5) / 100;
          const stolenAmount = Math.floor((dbTarget.coins ?? 0) * stealPercent);

          await prisma.$transaction([
            incrementCoinsSafe(dbUser.id, stolenAmount),
            prisma.user.update({ where: { id: dbTarget.id }, data: { coins: { decrement: stolenAmount } } })
          ]);

          const embed = new EmbedBuilder()
            .setTitle('🥷 Robbery Successful!')
            .setDescription(`You snuck up on <@${targetUser.id}> and stole ✨ **${stolenAmount} OpenSteam Coins**!\n\nYour new balance: **${((dbUser.coins ?? 0) + stolenAmount).toLocaleString()}** coins.`)
            .setColor(0x10b981)
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        } else {
          // Caught! Pay a fine of 10% to 20% of your own wealth, or at least 250
          const finePercent = (Math.floor(Math.random() * 11) + 10) / 100;
          const fine = Math.max(250, Math.floor((dbUser.coins ?? 0) * finePercent));

          // Half the fine goes to the target, half goes to the void
          const targetComp = Math.floor(fine / 2);

          await prisma.$transaction([
            prisma.user.update({ where: { id: dbUser.id }, data: { coins: { decrement: fine } } }),
            incrementCoinsSafe(dbTarget.id, targetComp)
          ]);

          const embed = new EmbedBuilder()
            .setTitle('🚨 BUSTED!')
            .setDescription(`You tried to rob <@${targetUser.id}> but you tripped the alarm and got caught by the Sentinel Guards!\n\nYou paid a fine of ✨ **${fine} OpenSteam Coins** (half given to the victim as compensation).\nYour new balance: **${Math.max(0, (dbUser.coins ?? 0) - fine).toLocaleString()}** coins.`)
            .setColor(0xef4444)
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
        }
      } catch (err) {
        console.error('[Economy] /rob error:', err);
        const payload = { content: '❌ Could not process this robbery right now. Try again in a moment.', ephemeral: false };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
    }

    if (interaction.commandName === 'highlow') {
      await interaction.deferReply();
      const betAmount = interaction.options.getInteger('bet');
      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      if (dbUser.coins < betAmount) {
        return interaction.editReply(`❌ You cannot bet **${betAmount} coins** because you only have **${dbUser.coins}**.`);
      }

      const hintNumber = Math.floor(Math.random() * 90) + 5; // 5 to 95
      
      const embed = new EmbedBuilder()
        .setTitle('📈 High / Low')
        .setDescription(`You are betting **${betAmount} coins**.\n\nThe hint number is: **${hintNumber}**\n\nWill the hidden number (1-100) be **higher** or **lower**?`)
        .setColor(0xf59e0b);

      const highButton = new ButtonBuilder()
        .setCustomId(`highlow_high_${betAmount}_${hintNumber}`)
        .setLabel('Higher')
        .setStyle(ButtonStyle.Success);
      const lowButton = new ButtonBuilder()
        .setCustomId(`highlow_low_${betAmount}_${hintNumber}`)
        .setLabel('Lower')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(highButton, lowButton);

      await interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (interaction.commandName === '8ball') {
      const question = interaction.options.getString('question');
      const answers = [
        'It is certain. 🔮', 'It is decidedly so. 🔮', 'Without a doubt. 🔮', 'Yes definitely. 🔮',
        'You may rely on it. 🔮', 'As I see it, yes. 🔮', 'Most likely. 🔮', 'Outlook good. 🔮',
        'Yes. 🔮', 'Signs point to yes. 🔮', 'Reply hazy, try again. 🔮', 'Ask again later. 🔮',
        'Better not tell you now. 🔮', 'Cannot predict now. 🔮', 'Concentrate and ask again. 🔮',
        'Don\'t count on it. 🔮', 'My reply is no. 🔮', 'My sources say no. 🔮',
        'Outlook not so good. 🔮', 'Very doubtful. 🔮'
      ];
      const answer = answers[Math.floor(Math.random() * answers.length)];

      const embed = new EmbedBuilder()
        .setTitle('🔮 Magic 8-Ball Wisdom')
        .addFields(
          { name: '❓ Question', value: question },
          { name: '💡 Wisdom', value: answer }
        )
        .setColor(0x4f46e5)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'coinflip') {
      const outcomes = ['Heads 🪙', 'Tails 🪙'];
      const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];

      const embed = new EmbedBuilder()
        .setTitle('🪙 Coinflip')
        .setDescription(`The coin spins in the air and lands on...\n\n**${outcome}**!`)
        .setColor(0xfacc15)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'gamble') {
      await interaction.deferReply();
      const amount = interaction.options.getInteger('amount');
      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      if (dbUser.coins < amount) {
        return interaction.editReply(`❌ You cannot gamble **${amount} coins** because you only have **${dbUser.coins}**.`);
      }

      const roll = Math.random() < 0.5; // 50% win/lose
      if (roll) {
        await incrementCoinsSafe(dbUser.id, amount);
        const embed = new EmbedBuilder()
          .setTitle('🎲 Dice Roll - YOU WON!')
          .setDescription(`🎲 You wagered **${amount} coins** and rolled a winning combination!\n\n✨ Got **+${amount} coins**! New balance: **${(dbUser.coins + amount).toLocaleString()}** coins.`)
          .setColor(0x10b981)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { coins: { decrement: amount } }
        });
        const embed = new EmbedBuilder()
          .setTitle('🎲 Dice Roll - YOU LOST!')
          .setDescription(`🎲 You wagered **${amount} coins** and rolled a losing combination.\n\n💥 Lost **-${amount} coins**... New balance: **${(dbUser.coins - amount).toLocaleString()}** coins.`)
          .setColor(0xef4444)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    }

    if (interaction.commandName === 'slots') {
      await interaction.deferReply();
      const amount = interaction.options.getInteger('amount');
      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      if (dbUser.coins < amount) {
        return interaction.editReply(`❌ You cannot bet **${amount} coins** because you only have **${dbUser.coins}**.`);
      }

      const emojis = ['🍒', '🍋', '🍇', '🔔', '💎', '⭐'];
      const slot1 = emojis[Math.floor(Math.random() * emojis.length)];
      const slot2 = emojis[Math.floor(Math.random() * emojis.length)];
      const slot3 = emojis[Math.floor(Math.random() * emojis.length)];

      let multiplier = 0;
      let winText = '';

      if (slot1 === slot2 && slot2 === slot3) {
        multiplier = 5;
        winText = '🎉 SUPER JACKPOT! 3 matching slots!';
      } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
        multiplier = 2;
        winText = '🌟 MINOR JACKPOT! 2 matching slots!';
      } else {
        multiplier = 0;
        winText = '💥 Better luck next time!';
      }

      if (multiplier > 0) {
        const winnings = amount * multiplier;
        await incrementCoinsSafe(dbUser.id, winnings - amount);
        const embed = new EmbedBuilder()
          .setTitle('🎰 OpenSteam Slots')
          .setDescription(`[ ${slot1} | ${slot2} | ${slot3} ]\n\n**${winText}**\nYou won **+${winnings} coins**! New balance: **${(dbUser.coins + winnings - amount).toLocaleString()}** coins.`)
          .setColor(0xf59e0b)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { coins: { decrement: amount } }
        });
        const embed = new EmbedBuilder()
          .setTitle('🎰 OpenSteam Slots')
          .setDescription(`[ ${slot1} | ${slot2} | ${slot3} ]\n\n**${winText}**\nYou lost **-${amount} coins**. New balance: **${(dbUser.coins - amount).toLocaleString()}** coins.`)
          .setColor(0xef4444)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    }

    if (interaction.commandName === 'leaderboard') {
      await interaction.deferReply();
      const topUsers = await prisma.user.findMany({
        orderBy: { coins: 'desc' },
        take: 10,
        select: { username: true, coins: true, discordId: true }
      });

      let description = '🏆 Top 10 richest OpenSteam users! 🏆\n\n';
      topUsers.forEach((u, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`#${i + 1}\``;
        description += `${medal} <@${u.discordId}>: **${u.coins.toLocaleString()}** coins\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 OpenSteam Economy Leaderboard')
        .setDescription(description)
        .setColor(0xf59e0b)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'pay') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      if (targetUser.id === interaction.user.id) {
        return interaction.editReply('❌ You cannot pay yourself.');
      }

      const dbUser = await getOrSyncUser(interaction.user);
      const dbTarget = await getOrSyncUser(targetUser);

      if (!dbUser || !dbTarget) {
        return interaction.editReply('❌ Failed to sync profiles.');
      }

      if (dbUser.coins < amount) {
        return interaction.editReply(`❌ Insufficient coins! You wagered to transfer **${amount}** but only have **${dbUser.coins}**.`);
      }

      await prisma.$transaction([
        prisma.user.update({ where: { id: dbUser.id }, data: { coins: { decrement: amount } } }),
        incrementCoinsSafe(dbTarget.id, amount)
      ]);

      await prisma.auditLog.create({
        data: {
          userId: dbUser.id,
          action: 'TRANSFER_COINS',
          targetId: dbTarget.id,
          details: `Transferred ${amount} coins to ${targetUser.tag}`,
          ip: 'DiscordBot'
        }
      });

      await interaction.editReply(`✅ Successfully transferred **${amount} OpenSteam Coins** to <@${targetUser.id}>!`);
    }

    if (interaction.commandName === 'rps') {
      await interaction.deferReply();
      const choice = interaction.options.getString('choice');
      const wager = interaction.options.getInteger('wager') || 0;

      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.editReply('❌ Failed to sync your profile.');

      if (wager > 0 && dbUser.coins < wager) {
        return interaction.editReply(`❌ You cannot bet **${wager} coins** because you only have **${dbUser.coins}**.`);
      }

      const moves = ['rock', 'paper', 'scissors'];
      const botMove = moves[Math.floor(Math.random() * moves.length)];
      const botIcons = { rock: '🪨', paper: '📄', scissors: '✂️' };
      const playerIcon = botIcons[choice];
      const botIcon = botIcons[botMove];

      let result = ''; // win, lose, tie
      if (choice === botMove) {
        result = 'tie';
      } else if (
        (choice === 'rock' && botMove === 'scissors') ||
        (choice === 'paper' && botMove === 'rock') ||
        (choice === 'scissors' && botMove === 'paper')
      ) {
        result = 'win';
      } else {
        result = 'lose';
      }

      if (result === 'win') {
        if (wager > 0) {
          await incrementCoinsSafe(dbUser.id, wager);
        }
        const embed = new EmbedBuilder()
          .setTitle('✂️ Rock-Paper-Scissors: YOU WIN!')
          .setDescription(`You: **${playerIcon} ${choice}**\nBot: **${botIcon} ${botMove}**\n\n🎉 Congratulations! You won the match!\n${wager > 0 ? `✨ Got **+${wager} coins**! New balance: **${(dbUser.coins + wager).toLocaleString()}** coins.` : ''}`)
          .setColor(0x10b981)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (result === 'tie') {
        const embed = new EmbedBuilder()
          .setTitle('✂️ Rock-Paper-Scissors: DRAW!')
          .setDescription(`You: **${playerIcon} ${choice}**\nBot: **${botIcon} ${botMove}**\n\n🤝 It\'s a tie match!\n${wager > 0 ? `Refunding wager of **${wager} coins**.` : ''}`)
          .setColor(0x9ca3af)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        if (wager > 0) {
          await prisma.user.update({ where: { id: dbUser.id }, data: { coins: { decrement: wager } } });
        }
        const embed = new EmbedBuilder()
          .setTitle('✂️ Rock-Paper-Scissors: YOU LOST')
          .setDescription(`You: **${playerIcon} ${choice}**\nBot: **${botIcon} ${botMove}**\n\n💥 Opps! Bot won the match.\n${wager > 0 ? `Lost **-${wager} coins**. New balance: **${(dbUser.coins - wager).toLocaleString()}** coins.` : ''}`)
          .setColor(0xef4444)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    }

    if (interaction.commandName === 'trivia') {
      await interaction.deferReply();
      const trivia = TRIVIA_POOL[Math.floor(Math.random() * TRIVIA_POOL.length)];
      const reward = 100; // 100 coins for answering correctly

      const embed = new EmbedBuilder()
        .setTitle('🧠 OpenSteam Active Trivia! 🧠')
        .setDescription(`**Question**: ${trivia.q}\n\nBe the first to click the correct option below to win **${reward} coins**! 💎`)
        .setColor(0x2563eb)
        .setTimestamp();

      const buttons = trivia.options.map((opt, i) => {
        return new ButtonBuilder()
          .setCustomId(`trivia_${i}_${opt.toLowerCase()}`)
          .setLabel(opt)
          .setStyle(ButtonStyle.Primary);
      });

      const row = new ActionRowBuilder().addComponents(buttons);

      const msg = await interaction.editReply({ embeds: [embed], components: [row] });
      activeTriviaQuestion.set(interaction.channelId, {
        question: trivia.q,
        answer: trivia.a,
        reward,
        options: trivia.options,
        msgId: msg.id
      });
    }

    // --- ADMINISTRATIVE COMMANDS ---

    if (interaction.commandName === 'grantrole') {
      const adminUser = await checkAdmin(interaction);
      if (!adminUser) return;

      if (!interaction.guild) {
        return interaction.reply({ content: '❌ This command only works in a server.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const hasRole = interaction.options.getRole('has_role');
      const grantRole = interaction.options.getRole('grant_role');

      if (!hasRole || !grantRole) {
        return interaction.editReply('❌ Both **has_role** and **grant_role** are required.');
      }
      if (hasRole.id === grantRole.id) {
        return interaction.editReply('❌ **has_role** and **grant_role** must be different.');
      }

      try {
        const guild = interaction.guild;
        const botMember = await guild.members.fetchMe();
        const botHighestPosition = botMember.roles.highest.position;

        if (grantRole.managed) {
          return interaction.editReply('❌ I cannot bulk-assign managed or integration roles.');
        }
        if (grantRole.position >= botHighestPosition) {
          return interaction.editReply(`❌ I cannot assign <@&${grantRole.id}> — it is at or above my highest role.`);
        }

        const candidates = await collectGrantRoleCandidates(guild, hasRole.id, grantRole.id);

        if (candidates.size === 0) {
          return interaction.editReply(
            `No members need <@&${grantRole.id}>. Everyone with <@&${hasRole.id}> already has it, or nobody has the source role.`
          );
        }

        const reason = `Bulk grant ${grantRole.name} to members with ${hasRole.name} by ${interaction.user.tag}`;
        const memberList = [...candidates.values()];
        const results = await runParallelPool(
          memberList,
          GRANTROLE_CONCURRENCY,
          (member) => grantRoleWithRetry(member, grantRole, reason)
        );

        const added = results.filter((result) => result.ok).length;
        const failedResults = results.filter((result) => !result.ok);
        const failed = failedResults.length;

        if (failed > 0) {
          console.warn(
            '[GrantRole] failures:',
            failedResults.slice(0, 15).map((result) => ({ memberId: result.memberId, error: result.error }))
          );
        }

        const alreadyHad = guild.members.cache.filter(
          (member) =>
            !member.user.bot &&
            member.roles.cache.has(hasRole.id) &&
            member.roles.cache.has(grantRole.id)
        ).size;

        await prisma.auditLog.create({
          data: {
            userId: adminUser.id,
            action: 'BULK_GRANT_ROLE',
            details: {
              hasRoleId: hasRole.id,
              hasRoleName: hasRole.name,
              grantRoleId: grantRole.id,
              grantRoleName: grantRole.name,
              added,
              failed,
              alreadyHad,
              concurrency: GRANTROLE_CONCURRENCY,
              failures: failedResults.slice(0, 25).map((result) => ({
                memberId: result.memberId,
                error: result.error,
              })),
            },
            ip: 'DiscordBot',
          },
        }).catch((err) => console.warn('[GrantRole] audit log failed:', err?.message || err));

        let reply =
          `Granted <@&${grantRole.id}> to **${added}** member(s) with <@&${hasRole.id}>.\n` +
          `Failed: **${failed}** · Already had both roles: **${alreadyHad}**`;

        if (failed > 0) {
          reply += `\n\nSome grants failed (often closed DMs are unrelated — check hierarchy/rate limits). First errors logged to audit + console.`;
        }

        return interaction.editReply(reply);
      } catch (err) {
        console.error('[GrantRole] command error:', err);
        return interaction.editReply(`❌ Bulk role grant failed: ${err.message || 'Unknown error'}`);
      }
    }

    if (interaction.commandName === 'promote') {
      if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ **Access Denied**: You must have the **Administrator** permission on Discord to use this command.', flags: MessageFlags.Ephemeral });
      }

      const targetMember = interaction.options.getMember('user');
      const targetRoleOption = interaction.options.getRole('role');

      if (!targetMember) {
        return interaction.reply({ content: '❌ **Error**: Target member not found in this guild.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();

      try {
        const guildRoles = await interaction.guild.roles.fetch();
        const botMember = await interaction.guild.members.fetch(client.user.id);
        const botHighestRolePosition = botMember.roles.highest.position;
        const executorHighestRolePosition = interaction.member.roles.highest.position;

        const assignableRoles = guildRoles
          .filter(role => 
            role.id !== interaction.guild.id && 
            !role.managed && 
            role.position < botHighestRolePosition && 
            role.position < executorHighestRolePosition 
          )
          .sort((a, b) => a.position - b.position)
          .toJSON();

        if (assignableRoles.length === 0) {
          return interaction.editReply('❌ **Error**: No assignable roles found below my hierarchy and yours.');
        }

        let targetRole = null;

        if (targetRoleOption) {
          const isAssignable = assignableRoles.some(r => r.id === targetRoleOption.id);
          if (!isAssignable) {
            return interaction.editReply(`❌ **Error**: The role <@&${targetRoleOption.id}> is above my hierarchy, managed, or above your hierarchy.`);
          }
          if (targetMember.roles.cache.has(targetRoleOption.id)) {
            return interaction.editReply(`❌ **Status**: **${targetMember.user.username}** already has the role <@&${targetRoleOption.id}>.`);
          }
          targetRole = targetRoleOption;
        } else {
          const targetCurrentRoles = assignableRoles.filter(role => targetMember.roles.cache.has(role.id));
          
          if (targetCurrentRoles.length === 0) {
            targetRole = assignableRoles[0];
          } else {
            const highestRole = targetCurrentRoles[targetCurrentRoles.length - 1];
            const currentIndex = assignableRoles.findIndex(role => role.id === highestRole.id);

            if (currentIndex === assignableRoles.length - 1) {
              return interaction.editReply(`❌ **Status**: **${targetMember.user.username}** is already at the highest assignable role (<@&${highestRole.id}>).`);
            }
            
            targetRole = assignableRoles[currentIndex + 1];

            try {
              await targetMember.roles.remove(highestRole);
            } catch (err) {
              console.warn(`[Promote] Failed to remove previous role ${highestRole.name}:`, err.message);
            }
          }
        }

        await targetMember.roles.add(targetRole);

        let platformSyncMessage = '';
        try {
          const { resolvePlatformRoleFromDiscordRoleName } = require('./lib/discord-role-mapping');
          const dbUser = await prisma.user.findUnique({ where: { discordId: targetMember.user.id } });
          if (dbUser) {
            const newPlatformRole = resolvePlatformRoleFromDiscordRoleName(targetRole.name);

            if (newPlatformRole && dbUser.role !== newPlatformRole) {
              await prisma.user.update({
                where: { discordId: targetMember.user.id },
                data: { role: newPlatformRole }
              });
              platformSyncMessage = `\n🔄 **Platform Sync**: Synced web account role to **${newPlatformRole}**.`;
            }
          }
        } catch (dbErr) {
          console.warn('[Promote] Failed to sync platform user role:', dbErr.message);
        }

        try {
          const adminDbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
          if (adminDbUser) {
            await prisma.auditLog.create({
              data: {
                userId: adminDbUser.id,
                action: 'PROMOTE_USER',
                targetId: targetMember.user.id,
                details: {
                  promotedToRoleName: targetRole.name,
                  promotedToRoleId: targetRole.id,
                  platformSynced: platformSyncMessage !== ''
                }
              }
            });
          }
        } catch (logErr) {
          console.warn('[Promote] Failed to create audit log:', logErr.message);
        }

        const embed = new EmbedBuilder()
          .setTitle('📈 Member Promoted!')
          .setDescription(`**${targetMember.user.tag}** has been promoted to <@&${targetRole.id}>!${platformSyncMessage}`)
          .setColor(0x10b981)
          .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        try {
          await sendUserDirectMessage(targetMember.user, {
            content: `🎉 **Congratulations!** You have been promoted to the role **${targetRole.name}** in the **${interaction.guild.name}** server!`
          });
        } catch (dmErr) {
          console.log('[Promote] Could not DM user.');
        }

      } catch (e) {
        console.error('[Promote Error]', e);
        await interaction.editReply(`❌ **Error**: Failed to promote member. Details: ${e.message}`);
      }
    }

    if (interaction.commandName === 'demote') {
      if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ **Access Denied**: You must have the **Administrator** permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const targetMember = interaction.options.getMember('user');
      const targetRoleOption = interaction.options.getRole('role');

      if (!targetMember) {
        return interaction.reply({ content: '❌ **Error**: Target member not found in this guild.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();

      try {
        const guildRoles = await interaction.guild.roles.fetch();
        const botMember = await interaction.guild.members.fetch(client.user.id);
        const botHighestRolePosition = botMember.roles.highest.position;
        const executorHighestRolePosition = interaction.member.roles.highest.position;

        const assignableRoles = guildRoles
          .filter(role => 
            role.id !== interaction.guild.id && 
            !role.managed && 
            role.position < botHighestRolePosition && 
            role.position < executorHighestRolePosition 
          )
          .sort((a, b) => a.position - b.position)
          .toJSON();

        if (assignableRoles.length === 0) {
          return interaction.editReply('❌ **Error**: No assignable roles found.');
        }

        let targetRole = null;
        let removedRole = null;
        let isRemovalOnly = false;

        if (targetRoleOption) {
          const isAssignable = assignableRoles.some(r => r.id === targetRoleOption.id);
          if (!isAssignable) {
            return interaction.editReply(`❌ **Error**: The role <@&${targetRoleOption.id}> is above my hierarchy or yours.`);
          }
          if (!targetMember.roles.cache.has(targetRoleOption.id)) {
            return interaction.editReply(`❌ **Status**: **${targetMember.user.username}** does not have the role <@&${targetRoleOption.id}>.`);
          }
          removedRole = targetRoleOption;
          await targetMember.roles.remove(removedRole);
        } else {
          const targetCurrentRoles = assignableRoles.filter(role => targetMember.roles.cache.has(role.id));
          
          if (targetCurrentRoles.length === 0) {
            return interaction.editReply(`❌ **Status**: **${targetMember.user.username}** does not hold any assignable hierarchy roles to demote.`);
          }

          const highestRole = targetCurrentRoles[targetCurrentRoles.length - 1];
          const currentIndex = assignableRoles.findIndex(role => role.id === highestRole.id);

          removedRole = highestRole;

          if (currentIndex === 0) {
            isRemovalOnly = true;
            await targetMember.roles.remove(removedRole);
          } else {
            targetRole = assignableRoles[currentIndex - 1];
            await targetMember.roles.remove(removedRole);
            await targetMember.roles.add(targetRole);
          }
        }

        let platformSyncMessage = '';
        try {
          const { resolvePlatformRoleFromDiscordRoleName } = require('./lib/discord-role-mapping');
          const dbUser = await prisma.user.findUnique({ where: { discordId: targetMember.user.id } });
          if (dbUser) {
            let newPlatformRole = 'USER';
            if (targetRole && !isRemovalOnly) {
              newPlatformRole = resolvePlatformRoleFromDiscordRoleName(targetRole.name) || 'USER';
            }

            if (dbUser.role !== newPlatformRole) {
              await prisma.user.update({
                where: { discordId: targetMember.user.id },
                data: { role: newPlatformRole }
              });
              platformSyncMessage = `\n🔄 **Platform Sync**: Synced web account role to **${newPlatformRole}**.`;
            }
          }
        } catch (dbErr) {
          console.warn('[Demote] Failed to sync platform role:', dbErr.message);
        }

        try {
          const adminDbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
          if (adminDbUser) {
            await prisma.auditLog.create({
              data: {
                userId: adminDbUser.id,
                action: 'DEMOTE_USER',
                targetId: targetMember.user.id,
                details: {
                  demotedFromRoleName: removedRole.name,
                  demotedFromRoleId: removedRole.id,
                  demotedToRoleName: targetRole ? targetRole.name : 'None',
                  demotedToRoleId: targetRole ? targetRole.id : 'None',
                  platformSynced: platformSyncMessage !== ''
                }
              }
            });
          }
        } catch (logErr) {
          console.warn('[Demote] Failed to create audit log:', logErr.message);
        }

        const embed = new EmbedBuilder()
          .setTitle('📉 Member Demoted!')
          .setDescription(`**${targetMember.user.tag}** has been demoted from <@&${removedRole.id}>${targetRole ? ` to <@&${targetRole.id}>` : ' (removed from all staff roles)'}!${platformSyncMessage}`)
          .setColor(0xef4444)
          .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        try {
          await sendUserDirectMessage(targetMember.user, {
            content: `⚠️ **Notice**: You have been demoted in the **${interaction.guild.name}** server. Your role was changed from **${removedRole.name}** to **${targetRole ? targetRole.name : 'None'}**.`
          });
        } catch (dmErr) {
          console.log('[Demote] Could not DM user.');
        }

      } catch (e) {
        console.error('[Demote Error]', e);
        await interaction.editReply(`❌ **Error**: Failed to demote member. Details: ${e.message}`);
      }
    }

    if (interaction.commandName === 'warn') {
      if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ **Access Denied**: You must have the **Administrator** permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const targetMember = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');
      const proofAttachment = interaction.options.getAttachment('proof');
      const proofUrl = proofAttachment ? proofAttachment.url : null;

      if (!targetMember) {
        return interaction.reply({ content: '❌ **Error**: Target member not found in this guild.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const adminDbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
        if (!adminDbUser) {
          return interaction.editReply('❌ **Error**: You do not have a registered profile in the OpenSteam database.');
        }

        // 1. Create a synchronized Punishment in the database
        const targetUserDb = await prisma.user.findUnique({ where: { discordId: targetMember.user.id } });
        await prisma.punishment.create({
          data: {
            userId: targetUserDb ? targetUserDb.id : null,
            discordId: targetMember.user.id,
            username: targetMember.user.username,
            moderatorId: interaction.user.id,
            moderatorName: interaction.user.username,
            type: 'WARN',
            reason: reason,
            duration: null,
            proofUrl: proofUrl
          }
        });

        // 2. Create Audit Log
        await prisma.auditLog.create({
          data: {
            userId: adminDbUser.id,
            action: 'WARN_USER',
            targetId: targetMember.user.id,
            details: {
              reason: reason,
              moderatorTag: interaction.user.tag,
              moderatorId: interaction.user.id,
              hasProof: proofUrl !== null
            }
          }
        });

        // 3. Count total warning punishments
        const warningCount = await prisma.punishment.count({
          where: {
            discordId: targetMember.user.id,
            type: 'WARN'
          }
        });

        let dmSent = true;
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle(`⚠️ Warning in ${interaction.guild.name}`)
            .setDescription(`You have received a formal warning in **${interaction.guild.name}**.\n\n**Reason**: ${reason}\n**Total Warnings**: **${warningCount}**${proofUrl ? `\n**Proof Linked**: [View Attached Screenshot](${proofUrl})` : ''}`)
            .setColor(0xf59e0b)
            .setTimestamp();
          
          if (proofUrl) dmEmbed.setImage(proofUrl);
          
          await sendUserDirectMessage(targetMember.user, { embeds: [dmEmbed] });
        } catch (dmErr) {
          dmSent = false;
          console.warn('[Warn] Could not DM user:', dmErr.message);
        }

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ Warning Issued!')
          .setDescription(`**${targetMember.user.tag}** has been formally warned.\n\n**Reason**: ${reason}\n**Total Infractions**: **${warningCount}**\n**User DM**: ${dmSent ? '🟢 Delivered' : '🔴 Failed (DMs off)'}`)
          .setColor(0xf59e0b)
          .setTimestamp();
          
        if (proofUrl) {
          successEmbed.addFields({ name: 'Proof Screenshot', value: `[View Proof Image](${proofUrl})` });
        }

        await interaction.editReply({ embeds: [successEmbed] });

      } catch (e) {
        console.error('[Warn Error]', e);
        await interaction.editReply(`❌ **Error**: Failed to issue warning: ${e.message}`);
      }
    }

    if (interaction.commandName === 'timeout') {
      if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ **Access Denied**: You must have the **Administrator** permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const targetMember = interaction.options.getMember('user');
      const durationStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const proofAttachment = interaction.options.getAttachment('proof');
      const proofUrl = proofAttachment ? proofAttachment.url : null;

      if (!targetMember) {
        return interaction.reply({ content: '❌ **Error**: Target member not found in this guild.', flags: MessageFlags.Ephemeral });
      }

      const protectedReason = await getProtectedModerationReason(prisma, targetMember.user, targetMember, { action: 'mute' });
      if (protectedReason) {
        return interaction.reply({ content: `❌ **Error**: ${protectedReason}`, flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        let ms = 0;
        const match = durationStr.match(/^(\d+)([smhd])$/i);
        if (!match) {
          return interaction.editReply('❌ **Error**: Invalid duration format. Examples: `60s` (seconds), `5m` (minutes), `2h` (hours), `1d` (days).');
        }

        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        if (unit === 's') ms = value * 1000;
        else if (unit === 'm') ms = value * 60 * 1000;
        else if (unit === 'h') ms = value * 60 * 60 * 1000;
        else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;

        if (ms < 10000) {
          return interaction.editReply('❌ **Error**: Duration must be at least 10 seconds.');
        }
        if (ms > 28 * 24 * 60 * 60 * 1000) {
          return interaction.editReply('❌ **Error**: Discord timeout duration cannot exceed 28 days.');
        }

        await targetMember.timeout(ms, `${reason} (Muted by ${interaction.user.tag})`);

        // 1. Create a synchronized Punishment in the database
        const targetUserDb = await prisma.user.findUnique({ where: { discordId: targetMember.user.id } });
        await prisma.punishment.create({
          data: {
            userId: targetUserDb ? targetUserDb.id : null,
            discordId: targetMember.user.id,
            username: targetMember.user.username,
            moderatorId: interaction.user.id,
            moderatorName: interaction.user.username,
            type: 'TIMEOUT',
            reason: reason,
            duration: durationStr,
            proofUrl: proofUrl
          }
        });

        // 2. Create Audit Log
        try {
          const adminDbUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
          if (adminDbUser) {
            await prisma.auditLog.create({
              data: {
                userId: adminDbUser.id,
                action: 'MUTE_USER',
                targetId: targetMember.user.id,
                details: {
                  duration: durationStr,
                  milliseconds: ms,
                  reason: reason,
                  hasProof: proofUrl !== null
                }
              }
            });
          }
        } catch (dbErr) {
          console.warn('[Timeout] Failed to log audit:', dbErr.message);
        }

        let dmSent = true;
        try {
          await sendUserDirectMessage(targetMember.user, {
            content: `⏳ **Notice**: You have been timed out (muted) in **${interaction.guild.name}** for **${durationStr}**.\n\n**Reason**: ${reason}${proofUrl ? `\n**Proof Attached**: [View Screenshot](${proofUrl})` : ''}`
          });
        } catch (dmErr) {
          dmSent = false;
        }

        const embed = new EmbedBuilder()
          .setTitle('✅ Timeout Applied!')
          .setDescription(`**${targetMember.user.tag}** has been timed out for **${durationStr}**.\n\n**Reason**: ${reason}\n**User DM**: ${dmSent ? '🟢 Delivered' : '🔴 Failed (DMs off)'}`)
          .setColor(0xd97706)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (e) {
        console.error('[Timeout Error]', e);
        await interaction.editReply(`❌ **Error**: Failed to apply timeout. Details: ${e.message}`);
      }
    }

    if (interaction.commandName === 'modlogs') {
      if (!interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ **Access Denied**: You must have the **Administrator** permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const targetMember = interaction.options.getMember('user');
      if (!targetMember) {
        return interaction.reply({ content: '❌ **Error**: Target member not found in this guild.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const [auditLogs, punishments] = await Promise.all([
          prisma.auditLog.findMany({
            where: {
              targetId: targetMember.user.id,
              action: { in: ['PROMOTE_USER', 'DEMOTE_USER'] }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          }),
          prisma.punishment.findMany({
            where: {
              discordId: targetMember.user.id
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          })
        ]);

        const warningCount = await prisma.punishment.count({
          where: { discordId: targetMember.user.id, type: 'WARN' }
        });
        
        const muteCount = await prisma.punishment.count({
          where: { discordId: targetMember.user.id, type: 'TIMEOUT' }
        });

        // Combine logs and sort desc by date
        const combinedLogs = [];
        auditLogs.forEach(l => {
          combinedLogs.push({
            date: new Date(l.createdAt),
            action: l.action,
            reason: l.details && l.details.reason ? l.details.reason : '',
            details: l.details || {}
          });
        });
        punishments.forEach(p => {
          combinedLogs.push({
            date: new Date(p.createdAt),
            action: p.type === 'WARN' ? 'WARN_USER' : p.type === 'TIMEOUT' ? 'MUTE_USER' : p.type,
            reason: p.reason,
            details: {
              duration: p.duration,
              proofUrl: p.proofUrl
            }
          });
        });
        
        combinedLogs.sort((a, b) => b.date - a.date);
        const logsToShow = combinedLogs.slice(0, 10);

        const embed = new EmbedBuilder()
          .setTitle(`⚖️ Moderation History: ${targetMember.user.tag}`)
          .setDescription(`Infraction statistics for <@${targetMember.user.id}>:`)
          .setColor(0x4f46e5)
          .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: 'Total Warnings', value: `\`${warningCount}\``, inline: true },
            { name: 'Total Timeouts', value: `\`${muteCount}\``, inline: true }
          )
          .setTimestamp();

        if (logsToShow.length === 0) {
          embed.addFields({ name: 'History Logs', value: '🟢 Clean record! No moderation actions logged.' });
        } else {
          let logText = '';
          logsToShow.forEach((log) => {
            const dateStr = log.date.toLocaleDateString('cs-CZ');
            let actionName = '';
            if (log.action === 'WARN_USER') actionName = '⚠️ Warning';
            else if (log.action === 'MUTE_USER') actionName = '⏳ Timeout';
            else if (log.action === 'PROMOTE_USER') actionName = '📈 Promotion';
            else if (log.action === 'DEMOTE_USER') actionName = '📉 Demotion';

            const durationStr = log.details && log.details.duration ? ` (${log.details.duration})` : '';
            const reasonStr = log.reason ? ` - *${log.reason}*` : '';
            const proofStr = log.details && log.details.proofUrl ? ` 📸 [Proof](${log.details.proofUrl})` : '';
            const detailsStr = log.details && log.details.promotedToRoleName ? ` (to ${log.details.promotedToRoleName})` : 
                               log.details && log.details.demotedFromRoleName ? ` (from ${log.details.demotedFromRoleName})` : '';

            logText += `\`[${dateStr}]\` **${actionName}**${durationStr}${detailsStr}${reasonStr}${proofStr}\n`;
          });
          embed.addFields({ name: 'Recent Actions (Up to 10)', value: logText });
        }

        await interaction.editReply({ embeds: [embed] });

      } catch (e) {
        console.error('[Modlogs Error]', e);
        await interaction.editReply(`❌ **Error**: Failed to retrieve moderation history: ${e.message}`);
      }
    }

    if (interaction.commandName === 'onlinefix') {
      // 0. Rate limit & Scraping detection
      client.onlineFixRateLimits = client.onlineFixRateLimits || new Map();
      const now = Date.now();
      const userLimits = client.onlineFixRateLimits.get(interaction.user.id) || [];
      const recentUsage = userLimits.filter(time => now - time < 60000);
      
      if (recentUsage.length >= 10) {
        const embed = new EmbedBuilder()
          .setTitle('🚨 SCRAPING DETECTED 🚨')
          .setDescription('You are issuing commands too quickly.\n\n**Mass scraping of the OnlineFix API or Database is strictly prohibited and will result in a permanent account ban.** Please slow down.')
          .setColor(0xff0000)
          .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      recentUsage.push(now);
      client.onlineFixRateLimits.set(interaction.user.id, recentUsage);

      const gameName = interaction.options.getString('name');
      
      // 1. Resolve User
      const user = await getOrSyncUser(interaction.user);
      if (!user) {
        return accountNotLinkedReply(interaction);
      }

      const onlineFixGate = await assertGenCommandAccess(interaction, user);
      if (onlineFixGate) return onlineFixGate;

      await interaction.deferReply();
      
      try {
        console.log(`[OnlineFix] Fetching data for "${gameName}" requested by ${interaction.user.tag} (${interaction.user.id})`);

        const {
          searchOnlineFixViaApi,
          downloadOnlineFixArchive,
        } = require('./lib/onlinefix-api');

        const gamesToShow = await searchOnlineFixViaApi(gameName, {
          limit: 5,
          orderBySearch: true,
        }, { prismaClient: prisma });

        if (gamesToShow.length > 0) {
          const topGame = gamesToShow[0];

          // Fetch Steam base info for the top game
          let steamInfo = null;
          try {
            const { searchSteamStoreByName } = require('./lib/steam-app-list');
            const searchRes = await searchSteamStoreByName(topGame.name);
            if (searchRes.length > 0) {
              const appId = searchRes[0].appid;
              const detailsRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
                timeout: 5000,
                validateStatus: () => true
              });
              if (detailsRes.data && detailsRes.data[appId] && detailsRes.data[appId].success) {
                steamInfo = detailsRes.data[appId].data;
              }
            }
          } catch (err) {
            console.error('[Steam Fetch Error]', err.message);
          }

          const embed = new EmbedBuilder()
            .setTitle(`🎮 ${steamInfo ? steamInfo.name : topGame.name} (OnlineFix)`)
            .setColor(0x6366f1)
            .setTimestamp()
            .setFooter({ text: 'OpenSteam OnlineFix Lookup' });

          if (steamInfo?.header_image) {
            embed.setImage(steamInfo.header_image);
          }

          let description = steamInfo?.short_description
            ? `${steamInfo.short_description}\n\n`
            : '';

          description += `**Found ${gamesToShow.length} Download(s):**\n`;
          gamesToShow.forEach((game, index) => {
            description += `> **${index + 1}.** ${game.name} — \`${game.fileSize || 'Unknown'}\`\n`;
          });

          const MAX_ONLINEFIX_DISCORD_FILE = 25 * 1024 * 1024;
          let s3FileAttachment = null;

          try {
            console.log(`[OnlineFix] Resolving download via API for "${topGame.name}"...`);
            const archive = await downloadOnlineFixArchive(topGame.name, {
              maxBytes: MAX_ONLINEFIX_DISCORD_FILE,
            });
            if (archive?.buffer) {
              s3FileAttachment = new AttachmentBuilder(archive.buffer, {
                name: archive.fileName,
              });
              console.log(`[OnlineFix] Downloaded ${archive.fileName} (${(archive.contentLength / 1024 / 1024).toFixed(1)} MB) via API — attaching to message.`);
            } else {
              console.log(`[OnlineFix] File too large or not found via API for "${topGame.name}".`);
              description += `\n⚠️ *The file for **${topGame.name}** exceeds Discord's 25 MB upload limit or is unavailable.*`;
            }
          } catch (dlErr) {
            console.warn(`[OnlineFix] API download failed for "${topGame.name}":`, dlErr.message);
            description += `\n⚠️ *Could not retrieve the file via the OnlineFix API. Please try again later.*`;
          }

          embed.setDescription(description.slice(0, 4096));

          const replyPayload = {
            embeds: [embed],
          };

          if (s3FileAttachment) {
            replyPayload.content = `📦 Here's your file — **${topGame.name}** attached below:`;
            replyPayload.files = [s3FileAttachment];
          } else {
            replyPayload.content = '🔍 Results found — see details below:';
          }

          await interaction.editReply(replyPayload);
        } else {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle('❌ No Games Found')
                .setDescription(`No OnlineFix games found for "${gameName}"`)
                .setColor(0xef4444)
                .setTimestamp()
            ]
          });
        }
      } catch (err) {
        console.error('[OnlineFix Command Error]', err);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ Unexpected Error')
              .setDescription('An unexpected error occurred while processing your request.')
              .setColor(0xef4444)
              .setTimestamp()
          ]
        });
      }
      return;
    }

    if (interaction.commandName === 'giveaway') {
      try {
        await handleGiveawayCommand(interaction, prisma, client);
      } catch (err) {
        console.error('[Giveaway] command error:', err);
        const payload = { content: 'Could not process this giveaway command right now.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (interaction.commandName === 'add') {
      try {
        await handleAddCommand(interaction, prisma);
      } catch (err) {
        console.error('[Add] command error:', err);
        const payload = { content: 'Could not update the Discord link right now.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    if (interaction.commandName === 'set') {
      try {
        await handleSetCommand(interaction, prisma, {
          repostVerifyPanel: () => ensureVerifyMessage(client),
        });
      } catch (err) {
        console.error('[Set] command error:', err);
        const payload = { content: 'Could not update the upload channel right now.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }
  });

  // Handle Buttons
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId } = interaction;

    if (customId.startsWith('ggw_')) {
      try {
        const handled = await handleGiveawayButton(interaction, prisma, client);
        if (handled) return;
      } catch (err) {
        console.error('[Giveaway] button error:', err);
        const payload = { content: 'Could not process this giveaway action right now.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
        return;
      }
    }

    if (customId === 'verify:start') {
      try {
        const verifyCfg = await getVerifyConfig();
        if (!verifyCfg.enabled) {
          return interaction.reply({ content: '❌ Verification is currently disabled.', flags: MessageFlags.Ephemeral });
        }

        const needsRenewal = await memberNeedsVerificationRenewal(interaction.user.id);
        const hasVerifiedRole = interaction.member?.roles?.cache?.has(verifyCfg.verifiedRoleId);

        if (hasVerifiedRole && !needsRenewal) {
          return interaction.reply({ content: '✅ You are already verified.', flags: MessageFlags.Ephemeral });
        }

        if (needsRenewal && interaction.member) {
          await resetMemberForVerificationRenewal(
            interaction.member,
            verifyCfg,
            'Guild rejoin — verification renewal required'
          );
        }

        const secret = verifyCfg.botToken;
        if (!secret) {
          return interaction.reply({ content: '❌ Verification is not configured. Contact staff.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const serverUrl = uploadServerUrl();
        const res = await fetch(`${serverUrl}/api/verify/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({
            discordId: interaction.user.id,
            guildId: interaction.guild?.id || verifyCfg.guildId,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          return interaction.editReply({ content: `❌ Could not start verification: ${data.error || res.status}` });
        }

        const linkRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Open verification').setStyle(ButtonStyle.Link).setURL(data.url)
        );

        return interaction.editReply({
          content: needsRenewal
            ? `🔐 Welcome back — re-verify on **${getSiteHostLabel()}** to refresh your account (link expires in 30 minutes).`
            : `🔐 Click below to complete verification on **${getSiteHostLabel()}** (link expires in 30 minutes).`,
          components: [linkRow],
        });
      } catch (err) {
        console.error('[Verify] button error:', err.message);
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply({ content: '❌ Verification failed to start. Try again later.' });
        }
        return interaction.reply({ content: '❌ Verification failed to start.', flags: MessageFlags.Ephemeral });
      }
    }

    // --- Message Report Interaction Handling ---
    if (customId.startsWith('report_')) {
      // 1. Check mod/staff permissions
      let isStaff = false;
      try {
        const sender = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
        if (sender && ['TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'].includes(sender.role)) {
          isStaff = true;
        }
      } catch (err) {}

      if (!isStaff) {
        isStaff = interaction.member?.permissions?.has('Administrator') || interaction.member?.permissions?.has('ManageMessages');
      }

      if (!isStaff) {
        return interaction.reply({ content: '❌ **Access Denied**: Only server moderators or administrators can review reports.', flags: MessageFlags.Ephemeral });
      }

      // 2. Decline flow
      if (customId.startsWith('report_decline_')) {
        const reportId = customId.replace('report_decline_', '');
        global.activeReports = global.activeReports || new Map();
        const report = global.activeReports.get(reportId);

        await interaction.deferUpdate();

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0x6b7280) // Muted grey
          .setTitle('❌ Report Declined')
          .setDescription(`Report was **declined** by <@${interaction.user.id}>. No penalty was issued to the user.`);

        await interaction.editReply({
          embeds: [embed],
          components: []
        }).catch(() => {});

        global.activeReports.delete(reportId);
        return;
      }

      // 3. Accept flow (presents actions)
      if (customId.startsWith('report_accept_')) {
        const reportId = customId.replace('report_accept_', '');
        global.activeReports = global.activeReports || new Map();
        const report = global.activeReports.get(reportId);

        if (!report) {
          return interaction.reply({ content: '❌ **Error**: Report data not found in cache. It may have expired or the bot restarted.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0xf59e0b) // Warning Amber
          .setTitle('⚠️ Report Accepted - Select Action')
          .setDescription(`Report has been **accepted** by <@${interaction.user.id}>.\nPlease select a penalty action below for <@${report.targetUserId}>:`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`report_punish_warn_${reportId}`)
            .setLabel('Warn ⚠️')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`report_punish_mute5m_${reportId}`)
            .setLabel('Timeout 5m ⏳')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`report_punish_mute1h_${reportId}`)
            .setLabel('Timeout 1h ⏳')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`report_punish_mute1d_${reportId}`)
            .setLabel('Timeout 1d ⏳')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`report_punish_dismiss_${reportId}`)
            .setLabel('No Penalty ❌')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
          embeds: [embed],
          components: [row]
        }).catch(() => {});
        return;
      }

      // 4. Punishment decision flow
      if (customId.startsWith('report_punish_')) {
        const parts = customId.split('_');
        const action = parts[2];
        const reportId = parts[3];

        global.activeReports = global.activeReports || new Map();
        const report = global.activeReports.get(reportId);

        if (!report) {
          return interaction.reply({ content: '❌ **Error**: Report data not found in cache. Action cancelled.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();

        try {
          const guild = interaction.guild;
          const targetMember = await guild.members.fetch(report.targetUserId).catch(() => null);

          let actionDescription = '';

          if (action === 'dismiss') {
            actionDescription = `No penalty was issued.`;
          } else if (action === 'warn') {
            const warningReason = `Reported in <#${report.channelId}>: "${report.messageContent}"`;
            
            const punishment = await prisma.punishment.create({
              data: {
                userId: null,
                discordId: report.targetUserId,
                username: report.targetUsername,
                moderatorId: interaction.user.id,
                moderatorName: interaction.user.username,
                type: 'WARN',
                reason: warningReason,
                proofUrl: report.proofUrl || null
              }
            });

            await prisma.auditLog.create({
              data: {
                userId: interaction.user.id,
                action: 'PUNISHMENT_CREATE',
                targetId: report.targetUserId,
                details: {
                  punishmentId: punishment.id,
                  type: 'WARN',
                  reason: warningReason,
                  proofUrl: report.proofUrl || null
                }
              }
            }).catch(() => {});

            const count = await prisma.punishment.count({
              where: { discordId: report.targetUserId, type: 'WARN' }
            });

            if (targetMember) {
              const dmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Formal Warning Issued')
                .setDescription(`You have received a formal warning on **${guild.name}**.`)
                .setColor(0xf59e0b)
                .addFields(
                  { name: 'Reason', value: warningReason },
                  { name: 'Moderator', value: interaction.user.tag },
                  { name: 'Total Warning Count', value: `\`${count}\`` }
                )
                .setTimestamp();
              if (report.proofUrl) {
                dmEmbed.setImage(report.proofUrl);
              }
              await sendUserDirectMessage(targetMember, { embeds: [dmEmbed] }).catch(() => {});
            }

            actionDescription = `Target user <@${report.targetUserId}> was **warned** for their reported message.`;

          } else if (action.startsWith('mute')) {
            const muteType = action.replace('mute', '');
            let durationMs = 0;
            let durationLabel = '';

            if (muteType === '5m') {
              durationMs = 5 * 60 * 1000;
              durationLabel = '5 minutes';
            } else if (muteType === '1h') {
              durationMs = 60 * 60 * 1000;
              durationLabel = '1 hour';
            } else if (muteType === '1d') {
              durationMs = 24 * 60 * 60 * 1000;
              durationLabel = '24 hours';
            }

            const muteReason = `Reported message: "${report.messageContent}"`;

            if (targetMember) {
              const protectedReason = await getProtectedModerationReason(
                prisma,
                targetMember.user,
                targetMember,
                { action: 'mute' },
              );
              if (protectedReason) {
                actionDescription = `Could not timeout <@${report.targetUserId}>: ${protectedReason}`;
              } else {
                await targetMember.timeout(durationMs, muteReason).catch(() => {});

                const punishment = await prisma.punishment.create({
                  data: {
                    userId: null,
                    discordId: report.targetUserId,
                    username: report.targetUsername,
                    moderatorId: interaction.user.id,
                    moderatorName: interaction.user.username,
                    type: 'TIMEOUT',
                    reason: muteReason,
                    duration: muteType,
                    proofUrl: report.proofUrl || null
                  }
                });

                await prisma.auditLog.create({
                  data: {
                    userId: interaction.user.id,
                    action: 'PUNISHMENT_CREATE',
                    targetId: report.targetUserId,
                    details: {
                      punishmentId: punishment.id,
                      type: 'TIMEOUT',
                      reason: muteReason,
                      duration: muteType,
                      proofUrl: report.proofUrl || null
                    }
                  }
                }).catch(() => {});

                const dmEmbed = new EmbedBuilder()
                  .setTitle('⏳ Temporary Timeout Applied')
                  .setDescription(`You have been put on timeout on **${guild.name}**.`)
                  .setColor(0x4f46e5)
                  .addFields(
                    { name: 'Duration', value: durationLabel },
                    { name: 'Reason', value: muteReason },
                    { name: 'Moderator', value: interaction.user.tag }
                  )
                  .setTimestamp();
                if (report.proofUrl) {
                  dmEmbed.setImage(report.proofUrl);
                }
                await sendUserDirectMessage(targetMember, { embeds: [dmEmbed] }).catch(() => {});

                actionDescription = `Target user <@${report.targetUserId}> was **timed out** for **${durationLabel}**.`;
              }
            }
          }

          const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x10b981)
            .setTitle('✅ Report Resolved')
            .setDescription(`Report resolved by <@${interaction.user.id}>.\n${actionDescription}`);

          await interaction.editReply({
            embeds: [embed],
            components: []
          }).catch(() => {});

          global.activeReports.delete(reportId);

        } catch (punishErr) {
          console.error('[Execute Punishment Error]', punishErr.message);
          await interaction.followUp({ content: `❌ **Error**: Failed to complete punishment: ${punishErr.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
      }
    }

    // --- Economy High/Low Button Claims ---
    if (customId.startsWith('highlow_')) {
      const parts = customId.split('_');
      // highlow_high_100_50
      const choice = parts[1]; // high or low
      const betAmount = parseInt(parts[2], 10);
      const hintNumber = parseInt(parts[3], 10);

      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return interaction.reply({ content: '❌ Profile sync error.', flags: MessageFlags.Ephemeral });

      // Verify they still have the coins (in case they spent them while the prompt was active)
      if (dbUser.coins < betAmount) {
        return interaction.reply({ content: '❌ You no longer have enough coins to cover this bet!', flags: MessageFlags.Ephemeral });
      }

      // Check if they are the original author of the message
      if (interaction.message.interaction && interaction.message.interaction.user.id !== interaction.user.id) {
          return interaction.reply({ content: '❌ This is not your game! Run `/highlow` to start your own.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferUpdate();

      const hiddenNumber = Math.floor(Math.random() * 100) + 1;
      
      let won = false;
      if (choice === 'high' && hiddenNumber > hintNumber) won = true;
      if (choice === 'low' && hiddenNumber < hintNumber) won = true;
      
      // Tie goes to the house
      if (hiddenNumber === hintNumber) won = false;

      if (won) {
        await incrementCoinsSafe(dbUser.id, betAmount);

        const embed = new EmbedBuilder()
          .setTitle('📈 High / Low - YOU WON!')
          .setDescription(`The hint number was **${hintNumber}**.\nYou guessed **${choice.toUpperCase()}**.\n\nThe hidden number was **${hiddenNumber}**!\n\nYou won ✨ **${betAmount} coins**! New balance: **${(dbUser.coins + betAmount).toLocaleString()}**`)
          .setColor(0x10b981);
        await interaction.editReply({ embeds: [embed], components: [] });
      } else {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { coins: { decrement: betAmount } }
        });

        const embed = new EmbedBuilder()
          .setTitle('📉 High / Low - YOU LOST!')
          .setDescription(`The hint number was **${hintNumber}**.\nYou guessed **${choice.toUpperCase()}**.\n\nThe hidden number was **${hiddenNumber}**.\n\nYou lost ✨ **${betAmount} coins**... New balance: **${(dbUser.coins - betAmount).toLocaleString()}**`)
          .setColor(0xef4444);
        await interaction.editReply({ embeds: [embed], components: [] });
      }
    }

    // --- Economy Coin Drop Button Claims ---
    if (customId.startsWith('claim_coin_drop_')) {
      await interaction.deferUpdate();
      const amount = parseInt(customId.replace('claim_coin_drop_', ''), 10);

      const dbUser = await getOrSyncUser(interaction.user);
      if (!dbUser) return;

      // Update the message so no one else can claim
      const embed = new EmbedBuilder()
        .setTitle('🎁 Coin Pouch Claimed!')
        .setDescription(`🎉 <@${interaction.user.id}> was the fastest and claimed the pouch of **✨ ${amount} OpenSteam Coins**!\n\nNew Balance: **${(dbUser.coins + amount).toLocaleString()}** coins.`)
        .setColor(0x10b981)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], components: [] });

      // Increment coins in DB
      await incrementCoinsSafe(dbUser.id, amount);
      return;
    }

    // --- Economy Trivia Answer Button Clicks ---
    if (customId.startsWith('trivia_')) {
      const active = activeTriviaQuestion.get(interaction.channelId);
      if (!active) {
        return interaction.reply({ content: '❌ This trivia question is no longer active.', flags: MessageFlags.Ephemeral });
      }

      const parts = customId.split('_');
      const selectedOption = parts.slice(2).join('_').toLowerCase();

      if (selectedOption === active.answer.toLowerCase()) {
        await interaction.deferUpdate();

        const dbUser = await getOrSyncUser(interaction.user);
        if (!dbUser) return;

        // Reward the correct answerer
        await incrementCoinsSafe(dbUser.id, active.reward);

        // Update active message to show winner
        const embed = new EmbedBuilder()
          .setTitle('🧠 Trivia Answered Correctly! 🧠')
          .setDescription(`🏆 <@${interaction.user.id}> was the first to answer correctly!\n\n**Question**: ${active.question}\n**Correct Answer**: **${active.answer.toUpperCase()}**\n\n✨ Awarded **+${active.reward} coins**!`)
          .setColor(0x10b981)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [] });
        activeTriviaQuestion.delete(interaction.channelId);
      } else {
        await interaction.reply({ content: '❌ Incorrect answer! Keep guessing!', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (customId.startsWith('donation_')) {
      // Check admin/staff
      const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
      if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
        return interaction.reply({ content: '❌ **Access Denied**: Staff visibility only.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferUpdate();

      if (customId.startsWith('donation_approve_')) {
        const donationId = customId.replace('donation_approve_', '');
        try {
          const { assignDonatorDiscordRole } = require('./lib/donator-role');
          const donation = await prisma.keyDonation.findUnique({
            where: { id: donationId },
            include: { user: true }
          });

          if (!donation || donation.status !== 'PENDING') return;

          await prisma.keyDonation.update({
            where: { id: donationId },
            data: { status: 'APPROVED' }
          });

          if (donation.user.discordId) {
            await assignDonatorDiscordRole(prisma, donation.user.discordId);
          }

          try {
            const dmUser = await client.users.fetch(donation.user.discordId);
            await sendUserDirectMessage(dmUser, `Thanks for donating **${donation.gameName}**! Your **Donator** Discord role has been applied. This is a community perk only — it does not grant moderator access.`);
          } catch (e) { }

          await interaction.editReply({
            content: `✅ Approved by <@${interaction.user.id}>`,
            components: []
          });
        } catch (e) {
          console.error('[Approve Error]', e);
        }
      }

      if (customId.startsWith('donation_reject_')) {
        const donationId = customId.replace('donation_reject_', '');
        try {
          const donation = await prisma.keyDonation.findUnique({
            where: { id: donationId },
            include: { user: true }
          });

          if (!donation || donation.status !== 'PENDING') return;

          await prisma.keyDonation.update({
            where: { id: donationId },
            data: { status: 'REJECTED' }
          });

          // DM User
          try {
            const dmUser = await client.users.fetch(donation.user.discordId);
            await sendUserDirectMessage(dmUser, `Your donation for **${donation.gameName}** was rejected. Donating non-Steam keys or random strings may result in a ban.`);
          } catch (e) { }

          await interaction.editReply({
            content: `❌ Rejected by <@${interaction.user.id}>`,
            components: []
          });
        } catch (e) {
          console.error('[Reject Error]', e);
        }
      }
    }

    // ─── Partnership Panel Button: open application modal ───────────────────
    if (customId === 'partnership:open') {
      const modal = new ModalBuilder()
        .setCustomId('partnership_modal')
        .setTitle('Partnership Application');

      const adInput = new TextInputBuilder()
        .setCustomId('partner_ad')
        .setLabel('Server Advertisement')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Paste your full server ad here...')
        .setRequired(true)
        .setMaxLength(4000);

      const inviteInput = new TextInputBuilder()
        .setCustomId('partner_invite')
        .setLabel('Discord Invite Link')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://discord.gg/...')
        .setRequired(true)
        .setMaxLength(200);

      const membersInput = new TextInputBuilder()
        .setCustomId('partner_members')
        .setLabel('Claimed Member Count')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 5500')
        .setRequired(true)
        .setMaxLength(20);

      const serverIdInput = new TextInputBuilder()
        .setCustomId('partner_server_id')
        .setLabel('Discord Server ID')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Right-click your server → Copy Server ID')
        .setRequired(true)
        .setMaxLength(30);

      modal.addComponents(
        new ActionRowBuilder().addComponents(adInput),
        new ActionRowBuilder().addComponents(inviteInput),
        new ActionRowBuilder().addComponents(membersInput),
        new ActionRowBuilder().addComponents(serverIdInput),
      );

      return interaction.showModal(modal);
    }

    // ─── Partner Reviewer Role: Approve-only from thread ───────────────────
    if (customId.startsWith('partner_hlapprove_')) {
      const REVIEWER_ROLE_ID = '1521172555782684732';
      const hasReviewerRole = interaction.member?.roles?.cache?.has(REVIEWER_ROLE_ID)
        || interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels);

      if (!hasReviewerRole) {
        return interaction.reply({ content: '❌ **Access Denied**: You do not have the partner reviewer role.', flags: MessageFlags.Ephemeral });
      }

      const ticketChannelId = customId.replace('partner_hlapprove_', '');
      const ticketData = activePartnershipTickets.get(ticketChannelId);

      await interaction.deferUpdate();

      // Post the ad to the partnership channel
      try {
        const adChannel = await client.channels.fetch(PARTNERSHIP_AD_CHANNEL_ID).catch(() => null);
        if (adChannel && ticketData) {
          await adChannel.send(ticketData.ad);
        }
      } catch (e) {
        console.error('[Partnership] HL Approve: failed to post ad:', e.message);
      }

      // Update the thread message embed
      const threadApprovedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x57f287)
        .setTitle('✅ Partnership Approved')
        .setDescription(`**Approved** by <@${interaction.user.id}> via reviewer thread.\n\nThe ad has been posted in the partnerships channel.`);

      await interaction.editReply({ embeds: [threadApprovedEmbed], components: [] }).catch(() => {});

      // Update the main ticket channel embed too
      try {
        const ticketChannel = await client.channels.fetch(ticketChannelId).catch(() => null);
        if (ticketChannel) {
          // Unlock the applicant
          if (ticketData) {
            await ticketChannel.permissionOverwrites.edit(ticketData.applicantId, {
              SendMessages: true,
            }).catch(() => {});
          }
          await ticketChannel.send({
            content: `✅ <@${ticketData?.applicantId ?? ''}> Your partnership application has been **approved** by our team! Your ad has been posted in the partnerships channel. Feel free to chat here!`,
          }).catch(() => {});
        }
      } catch (e) { /* best-effort */ }

      activePartnershipTickets.delete(ticketChannelId);
      return;
    }


    // ─── Partnership Staff Buttons: Approve / Deny / Ask Questions ──────────
    if (customId.startsWith('partner_approve_') || customId.startsWith('partner_deny_') || customId.startsWith('partner_askq_')) {
      // Only staff can press these
      let isStaff = false;
      try {
        const staffUser = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
        if (staffUser && ['TRIAL_MODERATOR', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMIN', 'OWNER'].includes(staffUser.role)) {
          isStaff = true;
        }
      } catch (_) {}
      if (!isStaff) {
        isStaff = interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels);
      }
      if (!isStaff) {
        return interaction.reply({ content: '❌ **Access Denied**: Only staff can review partnership applications.', flags: MessageFlags.Ephemeral });
      }

      const ticketChannelId = interaction.channelId;
      const ticketData = activePartnershipTickets.get(ticketChannelId);

      await interaction.deferUpdate();

      if (customId.startsWith('partner_approve_')) {
        // 1. Post the ad in the partnership channel
        try {
          const adChannel = await client.channels.fetch(PARTNERSHIP_AD_CHANNEL_ID).catch(() => null);
          if (adChannel && ticketData) {
            await adChannel.send(ticketData.ad);
          }
        } catch (e) {
          console.error('[Partnership] Failed to post ad in partnership channel:', e.message);
        }

        // 2. Update ticket embed to Approved
        const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0x57f287)
          .setTitle('✅ Partnership Approved')
          .setDescription(`**Approved** by <@${interaction.user.id}>\n\nThe partnership ad has been posted in the partnerships channel. The ticket will remain open for further communication.`);

        await interaction.editReply({ embeds: [approvedEmbed], components: [] }).catch(() => {});

        // 3. Unlock the channel so the applicant can speak
        try {
          const ticketChannel = interaction.channel;
          if (ticketData) {
            await ticketChannel.permissionOverwrites.edit(ticketData.applicantId, {
              SendMessages: true,
            }).catch(() => {});
          }
        } catch (e) { /* best-effort */ }

        await interaction.channel.send({
          content: `✅ <@${ticketData?.applicantId ?? ''}> Your partnership application has been **approved**! Your ad has been posted in our partnerships channel. Feel free to chat here!`,
        }).catch(() => {});

        activePartnershipTickets.delete(ticketChannelId);
        return;
      }

      if (customId.startsWith('partner_deny_')) {
        // 1. DM the applicant
        if (ticketData) {
          try {
            const applicantUser = await client.users.fetch(ticketData.applicantId).catch(() => null);
            if (applicantUser) {
              const dmEmbed = new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle('❌ Partnership Application Declined')
                .setDescription('Unfortunately, your partnership application with **OpenSteam** has been **declined**.\n\nYour application did not meet our current partnership requirements. Feel free to reapply in the future once your server has grown or meets our criteria.\n\nThank you for your interest!')
                .setTimestamp();
              await sendUserDirectMessage(applicantUser, { embeds: [dmEmbed] }).catch(() => {});
            }
          } catch (e) {
            console.error('[Partnership] Failed to DM applicant on deny:', e.message);
          }
        }

        // 2. Update embed and close channel
        const deniedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0xed4245)
          .setTitle('❌ Partnership Denied')
          .setDescription(`**Denied** by <@${interaction.user.id}>\n\nThe applicant has been notified via DM. This channel will be deleted shortly.`);

        await interaction.editReply({ embeds: [deniedEmbed], components: [] }).catch(() => {});

        await interaction.channel.send('❌ Partnership application denied. This channel will be deleted in **5 seconds**.').catch(() => {});

        activePartnershipTickets.delete(ticketChannelId);

        setTimeout(async () => {
          await interaction.channel.delete('Partnership application denied').catch(() => {});
        }, 5000);
        return;
      }

      if (customId.startsWith('partner_askq_')) {
        // Unlock the channel so applicant can respond, and update embed
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0xfee75c)
          .setTitle('❓ Partnership — Questions Pending')
          .setDescription(`**Questions requested** by <@${interaction.user.id}>\n\nThe applicant has been unlocked to reply. Staff will ask questions below.`);

        // Disable Ask Questions button, keep others active
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`partner_approve_${ticketChannelId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`partner_deny_${ticketChannelId}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`partner_askq_${ticketChannelId}`).setLabel('❓ Ask Questions').setStyle(ButtonStyle.Primary).setDisabled(true),
        );

        await interaction.editReply({ embeds: [updatedEmbed], components: [disabledRow] }).catch(() => {});

        // Unlock sending for the applicant
        if (ticketData) {
          await interaction.channel.permissionOverwrites.edit(ticketData.applicantId, {
            SendMessages: true,
          }).catch(() => {});
        }

        await interaction.channel.send({
          content: `❓ <@${ticketData?.applicantId ?? ''}> Our staff has some questions about your application. Please reply below!`,
        }).catch(() => {});
        return;
      }
    }
  });

  // ─── Partnership Modal Submit Handler ────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'partnership_modal') return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ad       = interaction.fields.getTextInputValue('partner_ad').trim();
    const invite   = interaction.fields.getTextInputValue('partner_invite').trim();
    const members  = interaction.fields.getTextInputValue('partner_members').trim();
    const serverId = interaction.fields.getTextInputValue('partner_server_id').trim();

    const applicant = interaction.user;
    const guild     = interaction.guild;

    if (!guild) {
      return interaction.editReply({ content: '❌ This can only be used inside a server.' });
    }

    // ── Pull public server data from Discord API ─────────────────────────────
    const PARTNERSHIP_MIN_MEMBERS = 5000;
    let verifiedName          = null;
    let verifiedMemberCount   = null;
    let verifiedOnlineCount   = null;
    let verifiedIcon          = null;
    let verifiedDescription   = null;
    let inviteCode            = null;
    let dataSource            = [];
    let requirementsMet       = true;
    let requirementErrors     = [];

    // Extract invite code from URL (handles discord.gg/code, discord.com/invite/code, raw codes)
    const inviteMatch = invite.match(/discord(?:\.gg|(?:\.com\/invite))\/([\w-]+)/i) || invite.match(/^([\w-]{2,30})$/);
    inviteCode = inviteMatch ? inviteMatch[1] : null;

    // 1. Fetch invite data (approximate counts — always public, no auth needed)
    if (inviteCode) {
      try {
        const inviteRes = await fetch(
          `https://discord.com/api/v10/invites/${inviteCode}?with_counts=true&with_expiration=true`,
          { headers: { 'User-Agent': 'OpenSteam-PartnerBot/1.0' }, signal: AbortSignal.timeout(8000) }
        );
        if (inviteRes.ok) {
          const inviteData = await inviteRes.json();
          const g = inviteData.guild;
          if (g) {
            verifiedName        = g.name        ?? verifiedName;
            verifiedDescription = g.description ?? verifiedDescription;
            verifiedIcon        = g.icon        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null;
          }
          if (typeof inviteData.approximate_member_count === 'number') {
            verifiedMemberCount = inviteData.approximate_member_count;
            dataSource.push('invite API');
          }
          if (typeof inviteData.approximate_presence_count === 'number') {
            verifiedOnlineCount = inviteData.approximate_presence_count;
          }
        } else {
          console.warn(`[Partnership] Invite API returned ${inviteRes.status} for code: ${inviteCode}`);
        }
      } catch (e) {
        console.warn('[Partnership] Invite API fetch failed:', e.message);
      }
    }

    // 2. Fetch guild widget (public if the server has it enabled — gives online members list)
    if (serverId && /^\d{17,20}$/.test(serverId)) {
      try {
        const widgetRes = await fetch(
          `https://discord.com/api/v10/guilds/${serverId}/widget.json`,
          { headers: { 'User-Agent': 'OpenSteam-PartnerBot/1.0' }, signal: AbortSignal.timeout(8000) }
        );
        if (widgetRes.ok) {
          const widgetData = await widgetRes.json();
          if (widgetData.name && !verifiedName) verifiedName = widgetData.name;
          if (Array.isArray(widgetData.members)) {
            verifiedOnlineCount = widgetData.members.length;
          }
          dataSource.push('guild widget');
        }
        // 403 = widget disabled (common, not an error)
      } catch (e) {
        console.warn('[Partnership] Guild widget fetch failed:', e.message);
      }
    } else if (serverId) {
      return interaction.editReply({ content: '❌ **Invalid Server ID** — Server IDs are 17–20 digit numbers. Right-click your server icon → *Copy Server ID* (Developer Mode must be enabled).' });
    }

    // ── Requirements check ──────────────────────────────────────────────────
    if (verifiedMemberCount !== null) {
      if (verifiedMemberCount < PARTNERSHIP_MIN_MEMBERS) {
        requirementsMet = false;
        requirementErrors.push(
          `❌ **Member count too low**: Your server has **${verifiedMemberCount.toLocaleString()}** members. We require **${PARTNERSHIP_MIN_MEMBERS.toLocaleString()}+** members.`
        );
      }
    } else {
      // Could not verify — warn but don't hard-block (invite may be expired/invalid)
      requirementErrors.push(
        `⚠️ **Could not verify member count** — make sure your invite link is valid and not expired. Claimed count: **${members}**.`
      );
    }

    if (!inviteCode) {
      requirementsMet = false;
      requirementErrors.push('❌ **Invalid invite link** — please provide a valid `discord.gg/...` invite URL.');
    }

    if (!requirementsMet) {
      return interaction.editReply({
        content: [
          '## ❌ Partnership Requirements Not Met',
          '',
          ...requirementErrors,
          '',
          `**Our requirements:**`,
          `• **${PARTNERSHIP_MIN_MEMBERS.toLocaleString()}+ members** (verified via Discord API)`,
          `• Valid, non-expired Discord invite link`,
          `• Active community`,
        ].join('\n'),
      });
    }

    // ── Build verification summary line for staff ────────────────────────────
    const verifyLine = verifiedMemberCount !== null
      ? `✅ **API Verified** via ${dataSource.join(' + ')}`
      : `⚠️ **Unverified** (invite may be invalid or expired)`;

    // Create a private ticket channel
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: `partner-${applicant.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}`,
        type: ChannelType.GuildText,
        topic: `Partnership application from ${applicant.tag}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          },
          {
            id: applicant.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages],
          },
          {
            // Partner reviewer role — can view ticket + interact in threads, cannot send in channel
            id: '1521172555782684732',
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads],
            deny: [PermissionFlagsBits.SendMessages],
          },
        ],
      });
    } catch (e) {
      console.error('[Partnership] Failed to create ticket channel:', e.message);
      return interaction.editReply({ content: '❌ Failed to create a ticket channel. Please contact staff.' });
    }

    // Store ticket data in memory
    activePartnershipTickets.set(ticketChannel.id, {
      applicantId:  applicant.id,
      applicantTag: applicant.tag,
      ad,
      invite,
      members,
      serverId,
    });

    // Build the review embed for staff (with verified data)
    const reviewEmbed = new EmbedBuilder()
      .setColor(requirementErrors.length > 0 ? 0xf59e0b : 0x5865f2)
      .setTitle('🤝 New Partnership Application')
      .setDescription([
        `**Applicant:** <@${applicant.id}> (\`${applicant.tag}\`)`,
        verifiedName ? `**Server Name:** ${verifiedName}` : '',
        verifiedDescription ? `**Server Description:** ${verifiedDescription}` : '',
        '',
        '**📢 Server Advertisement**',
        ad.length > 2048 ? ad.slice(0, 2045) + '...' : ad,
      ].filter(Boolean).join('\n'))
      .addFields(
        { name: '🔗 Invite Link',    value: invite, inline: true },
        { name: '🆔 Server ID',      value: `\`${serverId}\``, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        {
          name: '👥 Members (Claimed)',
          value: members,
          inline: true,
        },
        {
          name: '📊 Members (API Verified)',
          value: verifiedMemberCount !== null ? `**${verifiedMemberCount.toLocaleString()}**` : '`Could not verify`',
          inline: true,
        },
        {
          name: '🟢 Online (Approx.)',
          value: verifiedOnlineCount !== null ? `**${verifiedOnlineCount.toLocaleString()}**` : '`N/A`',
          inline: true,
        },
        { name: '🔍 Verification Status', value: verifyLine, inline: false },
      )
      .setFooter({ text: `Submitted by ${applicant.tag}` })
      .setTimestamp();

    if (verifiedIcon) reviewEmbed.setThumbnail(verifiedIcon);

    // Soft-warning field if we had non-blocking issues
    if (requirementErrors.length > 0) {
      reviewEmbed.addFields({
        name: '⚠️ Warnings',
        value: requirementErrors.join('\n'),
        inline: false,
      });
    }

    const staffRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`partner_approve_${ticketChannel.id}`)
        .setLabel('✅ Approve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`partner_deny_${ticketChannel.id}`)
        .setLabel('❌ Deny')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`partner_askq_${ticketChannel.id}`)
        .setLabel('❓ Ask Questions')
        .setStyle(ButtonStyle.Primary),
    );

    // Grant staff roles access to the ticket channel
    try {
      const staffRoles = guild.roles.cache.filter(r =>
        r.permissions.has(PermissionFlagsBits.ManageChannels) && !r.managed
      );
      for (const [, role] of staffRoles) {
        await ticketChannel.permissionOverwrites.edit(role.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});
      }
    } catch (e) { /* best-effort */ }

    // Post the review embed in the ticket channel
    const mainMsg = await ticketChannel.send({
      content: `📬 **New Partnership Application** — <@${applicant.id}> has applied for a partnership. Staff, please review below.`,
      embeds: [reviewEmbed],
      components: [staffRow],
    });

    // Inform the applicant
    await ticketChannel.send({
      content: `👋 <@${applicant.id}> Thank you for applying! Your application has been received and is being reviewed by our staff. **You cannot send messages until staff initiates a conversation.** Please be patient!`,
    });

    // ── Private thread for partner reviewer role (Approve-only) ──────────────
    try {
      const reviewThread = await mainMsg.startThread({
        name: `🔍 Partner Review — ${applicant.username}`,
        autoArchiveDuration: 1440,
      });

      // Build a compact server data embed for the thread
      const threadEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📋 Server Data — Partnership Review')
        .setDescription([
          `**Applicant:** <@${applicant.id}> (\`${applicant.tag}\`)`,
          verifiedName        ? `**Server Name:** ${verifiedName}`        : null,
          verifiedDescription ? `**Description:** ${verifiedDescription}` : null,
        ].filter(Boolean).join('\n'))
        .addFields(
          { name: '🔗 Invite',                value: invite, inline: true },
          { name: '🆔 Server ID',             value: `\`${serverId}\``, inline: true },
          { name: '\u200b',                   value: '\u200b', inline: true },
          {
            name: '👥 Members (Claimed)',
            value: members,
            inline: true,
          },
          {
            name: '📊 Members (API Verified)',
            value: verifiedMemberCount !== null ? `**${verifiedMemberCount.toLocaleString()}**` : '`Could not verify`',
            inline: true,
          },
          {
            name: '🟢 Online (Approx.)',
            value: verifiedOnlineCount !== null ? `**${verifiedOnlineCount.toLocaleString()}**` : '`N/A`',
            inline: true,
          },
          { name: '🔍 Verification', value: verifyLine, inline: false },
        )
        .setFooter({ text: 'Only Approve is available in this view — use the main ticket to Deny or Ask Questions.' })
        .setTimestamp();

      if (verifiedIcon) threadEmbed.setThumbnail(verifiedIcon);

      const approveOnlyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`partner_hlapprove_${ticketChannel.id}`)
          .setLabel('✅ Approve Partnership')
          .setStyle(ButtonStyle.Success),
      );

      await reviewThread.send({
        content: `<@&1521172555782684732> 🤝 A new partnership application is awaiting your review. You may **Approve** it below — to Deny or ask questions, use the main ticket channel.`,
        embeds: [threadEmbed],
        components: [approveOnlyRow],
      });

      console.log(`[Partnership] Created review thread ${reviewThread.id} for ticket ${ticketChannel.id}`);
    } catch (e) {
      console.error('[Partnership] Failed to create review thread:', e.message);
    }

    await interaction.editReply({ content: `✅ Your partnership application has been submitted! Check <#${ticketChannel.id}> for updates.` });
  });

  // --- Security Automation ---
  client.on('guildBanAdd', async (ban) => {
    try {
      if (softbannedUserIds.has(ban.user.id)) {
        console.log(`[Security] Detected ban for ${ban.user.tag} as part of a Softban. Skipping regular ban logging.`);
        return;
      }

      console.log(`[Security] Detected guild ban for ${ban.user.tag}. Applying web restrictions...`);

      let executorId = null;
      let reason = 'Automatically banned due to Discord Guild Ban';

      try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MemberBanAdd,
        });
        const banLog = fetchedLogs.entries.first();
        if (banLog && banLog.target && banLog.target.id === ban.user.id) {
          const executor = banLog.executor;
          if (executor) {
            const dbExecutor = await prisma.user.findUnique({ where: { discordId: executor.id } });
            if (dbExecutor) {
              executorId = dbExecutor.id;
            }
            reason = banLog.reason || reason;
          }
        }
      } catch (auditErr) {
        console.warn('[Security] Could not fetch ban audit log:', auditErr.message);
      }

      try {
        const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
        const secret = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
        const appUrl = uploadServerUrl();
        await fetch(`${appUrl}/api/admin/bot/sync-ban`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${secret}`
          },
          body: JSON.stringify({ discordId: ban.user.id, reason })
        });
      } catch (e) {
        console.error('[Security] Error calling sync-ban API:', e.message);
      }

      // Record to Punishment Logging (AuditLog Table)
      try {
        let punisherId = executorId;
        if (!punisherId) {
          const primaryOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
          if (primaryOwner) {
            punisherId = primaryOwner.id;
          } else {
            const anyAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
            if (anyAdmin) punisherId = anyAdmin.id;
          }
        }

        if (punisherId) {
          // Log punishment
          await prisma.auditLog.create({
            data: {
              userId: punisherId,
              action: 'PUNISHMENT_LOG',
              targetId: ban.user.id,
              details: JSON.stringify({
                username: ban.user.tag,
                discordId: ban.user.id,
                type: 'Ban',
                proof: 'Discord Server Ban',
                description: `Banned: ${reason}`
              }),
              ip: 'DiscordBot'
            }
          });

          // Also log admin action
          await prisma.auditLog.create({
            data: {
              userId: punisherId,
              action: 'BAN_USER',
              targetId: user ? user.id : ban.user.id,
              details: `Banned user via Discord Server Ban. Reason: ${reason}`,
              ip: 'DiscordBot'
            }
          });
        }
      } catch (punishErr) {
        console.error('[Security] Failed to write punishment audit log for guildBanAdd:', punishErr.message);
      }

    } catch (e) {
      console.error('[Security] Error syncing ban:', e.message);
    }
  });

  client.on('guildBanRemove', async (ban) => {
    try {
      if (softbannedUserIds.has(ban.user.id)) {
        console.log(`[Security] Detected unban for ${ban.user.tag} as part of a Softban. Keeping web ban intact.`);
        softbannedUserIds.delete(ban.user.id);
        return;
      }

      console.log(`[Security] Detected guild unban for ${ban.user.tag}. Unbanning on web...`);

      let executorId = null;
      let reason = 'Automatically unbanned due to Discord Guild Unban';

      try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MemberBanRemove,
        });
        const unbanLog = fetchedLogs.entries.first();
        if (unbanLog && unbanLog.target && unbanLog.target.id === ban.user.id) {
          const executor = unbanLog.executor;
          if (executor) {
            const dbExecutor = await prisma.user.findUnique({ where: { discordId: executor.id } });
            if (dbExecutor) {
              executorId = dbExecutor.id;
            }
            reason = unbanLog.reason || reason;
          }
        }
      } catch (auditErr) {
        console.warn('[Security] Could not fetch unban audit log:', auditErr.message);
      }

      try {
        const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
        const secret = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
        const appUrl = uploadServerUrl();
        await fetch(`${appUrl}/api/admin/bot/sync-unban`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${secret}`
          },
          body: JSON.stringify({ discordId: ban.user.id, reason })
        });
      } catch (e) {
        console.error('[Security] Error calling sync-unban API:', e.message);
      }

      // Record to Punishment Logging (AuditLog Table)
      try {
        let punisherId = executorId;
        if (!punisherId) {
          const primaryOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
          if (primaryOwner) {
            punisherId = primaryOwner.id;
          } else {
            const anyAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
            if (anyAdmin) punisherId = anyAdmin.id;
          }
        }

        if (punisherId) {
          // Log punishment restore
          await prisma.auditLog.create({
            data: {
              userId: punisherId,
              action: 'PUNISHMENT_LOG',
              targetId: ban.user.id,
              details: JSON.stringify({
                username: ban.user.tag,
                discordId: ban.user.id,
                type: 'Unban',
                proof: 'Discord Server Unban',
                description: `Restored: ${reason}`
              }),
              ip: 'DiscordBot'
            }
          });

          // Also log admin action
          await prisma.auditLog.create({
            data: {
              userId: punisherId,
              action: 'UNBAN_USER',
              targetId: user ? user.id : ban.user.id,
              details: `Unbanned user via Discord Server Unban. Reason: ${reason}`,
              ip: 'DiscordBot'
            }
          });
        }
      } catch (punishErr) {
        console.error('[Security] Failed to write punishment audit log for guildBanRemove:', punishErr.message);
      }

    } catch (e) {
      console.error('[Security] Error syncing unban:', e.message);
    }
  });

  // Dedup guard: prevents double-replies if two bot instances briefly overlap
  const recentlyHandledMessages = new Set();

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (recentlyHandledMessages.has(message.id)) return;
    recentlyHandledMessages.add(message.id);
    setTimeout(() => recentlyHandledMessages.delete(message.id), 30_000);

    // Manifest zip uploads → same API as dashboard / bulk-upload.ps1
    try {
      const handledUpload = await handleManifestUploadChannelMessage(message, prisma, {
        botToken: activeBot.token,
        client,
      });
      if (handledUpload) return;
    } catch (uploadErr) {
      console.error('[ManifestUpload] Handler error:', uploadErr?.message || uploadErr);
    }

    // AI Knowledge Base Chat & Staff Ticket Learning handler
    try {
      const handledAi = await handleDiscordAiMessage(message, client, prisma);
      if (handledAi) return;
    } catch (aiErr) {
      console.error('[AiChat] Handler error:', aiErr?.message || aiErr);
    }

    // Message mention-based report logic
    const containsReportWord = message.content.toLowerCase().includes('report');
    const isBotMentioned = message.mentions.has(client.user);
    if (isBotMentioned && containsReportWord) {
      try {
        // Check if it is a reply
        if (message.reference && message.reference.messageId) {
          const targetMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
          if (targetMessage) {
            await triggerModeratorReviewFlow(message.guild, message.author, targetMessage, targetMessage.author, targetMessage.content, targetMessage.url, targetMessage.attachments.first()?.url, message);
            return;
          }
        }
        // If not a reply, prompt them
        await message.reply('❌ **Report failed**: Please reply to the specific message you wish to report, ping me, and type `report`.').catch(() => {});
      } catch (err) {
        console.error('[Bot Report Mention Error]', err.message);
      }
      return;
    }

    // Skip checking if the sender is an admin or moderator in the DB
    try {
      const sender = await prisma.user.findUnique({ where: { discordId: message.author.id } });
      if (sender && ['ADMIN', 'OWNER'].includes(sender.role)) {
        return; // Skip security checks for staff
      }
    } catch (e) {
      console.warn('[Security] Failed to check staff status of message author:', e.message);
    }

    // --- Image Similarity Scanning ---
    try {
      if (message.member) {
        // 1. Check message attachments for images
        if (message.attachments && message.attachments.size > 0) {
          for (const [id, attachment] of message.attachments) {
            const isImage = attachment.contentType?.startsWith('image/') ||
              ['.jpg', '.jpeg', '.png', '.webp', '.gif'].some(ext => attachment.name?.toLowerCase().endsWith(ext));
            if (isImage) {
              const checkResult = await checkImageSimilarity(attachment.url);
              if (checkResult.match) {
                console.log(`[Security] Similarity match found on attachment from ${message.author.tag} (${checkResult.patternName}, similarity: ${checkResult.similarity.toFixed(2)})`);
                await softbanMember(message.member, `Matched malicious image pattern: ${checkResult.patternName} (${(checkResult.similarity * 100).toFixed(1)}% similarity)`, client);
                return; // Softbanned, stop further checks
              }
            }
          }
        }

        // 2. Check message embeds for images
        if (message.embeds && message.embeds.length > 0) {
          for (const embed of message.embeds) {
            const imageUrl = embed.image?.url || embed.thumbnail?.url;
            if (imageUrl) {
              const checkResult = await checkImageSimilarity(imageUrl);
              if (checkResult.match) {
                console.log(`[Security] Similarity match found on embed image from ${message.author.tag} (${checkResult.patternName}, similarity: ${checkResult.similarity.toFixed(2)})`);
                await softbanMember(message.member, `Matched malicious embed image pattern: ${checkResult.patternName} (${(checkResult.similarity * 100).toFixed(1)}% similarity)`, client);
                return; // Softbanned, stop further checks
              }
            }
          }
        }

        // 3. Check for text image links in message content
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const urls = message.content.match(urlRegex) || [];
        for (const url of urls) {
          const cleanUrl = url.split('?')[0];
          if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].some(ext => cleanUrl.toLowerCase().endsWith(ext))) {
            const checkResult = await checkImageSimilarity(url);
            if (checkResult.match) {
              console.log(`[Security] Similarity match found on text image link from ${message.author.tag} (${checkResult.patternName}, similarity: ${checkResult.similarity.toFixed(2)})`);
              await softbanMember(message.member, `Matched malicious image link pattern: ${checkResult.patternName} (${(checkResult.similarity * 100).toFixed(1)}% similarity)`, client);
              return; // Softbanned, stop further checks
            }
          }
        }

        // 4. Check sender's avatar
        const avatarCheckResult = await checkUserAvatar(message.member);
        if (avatarCheckResult.match) {
          console.log(`[Security] Similarity match found on avatar of ${message.author.tag} (${avatarCheckResult.patternName}, similarity: ${avatarCheckResult.similarity.toFixed(2)})`);
          await softbanMember(message.member, `Using blacklisted avatar image: ${avatarCheckResult.patternName} (${(avatarCheckResult.similarity * 100).toFixed(1)}% similarity)`, client);
          return; // Softbanned, stop further checks
        }
      }
    } catch (err) {
      console.error('[Security] Error in image similarity scanning:', err.message);
    }

    // --- Standard Malicious Content Regex Scanning ---
    const regexPattern = process.env.MALICIOUS_REGEX || '(d[l1i]scord[a-z0-9-]*\\.(gift|com|net|org|xyz|ru|pw|lol|epicgames)|free\\s+nitro|discord-gift|steam-discord)';
    let isMalicious = false;

    try {
      const regex = new RegExp(regexPattern, 'i');
      if (regex.test(message.content)) {
        isMalicious = true;
      }
    } catch (e) {
      console.warn('[Security] Invalid Regex Pattern:', e.message);
    }

    if (isMalicious) {
      try {
        console.log(`[Security] Malicious content detected from ${message.author.tag}. Suspending...`);
        await message.delete().catch(() => { });

        if (message.member && message.member.moderatable) {
          await message.member.timeout(24 * 60 * 60 * 1000, 'Suspicious Activity: Malicious link/word').catch(() => { });
        }

        const user = await prisma.user.findUnique({ where: { discordId: message.author.id } });
        if (user && !user.isBanned) {
          const jailUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await prisma.user.update({
            where: { id: user.id },
            data: { jailUntil, jailLevel: 1 }
          });
          await prisma.apiKey.updateMany({ where: { userId: user.id }, data: { enabled: false, adminDisable: true } });
          await prisma.sentinelLog.create({
            data: {
              userId: user.id,
              action: 'AUTO_JAIL',
              score: 50,
              reason: 'Suspicious Activity: Malicious message posted in Discord',
              details: JSON.stringify({ source: 'DiscordBotDaemon', event: 'messageCreate', content: message.content })
            }
          });

          try {
            await sendUserDirectMessage(message.author, '⚠️ Your OpenSteam account and Discord access have been temporarily suspended (24h) for posting suspicious/malicious content. API keys are disabled.');
          } catch (e) { }
        }
      } catch (e) {
        console.error('[Security] Error handling malicious message:', e.message);
      }
    }

    // --- Economy: Chat Activity Coins Reward ---
    try {
      if (!isMalicious && Math.random() < 0.10) {
        const dbUser = await getOrSyncUser(message.author);
        if (dbUser) {
          const rewardAmount = Math.floor(Math.random() * 7) + 2; // 2 to 8 coins
          await incrementCoinsSafe(dbUser.id, rewardAmount);
        }
      }
    } catch (e) {
      console.error('[Economy] Error rewarding chat activity:', e.message);
    }
  });


  // --- Avatar scan on new member join ---
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try {
      const sender = await prisma.user.findUnique({ where: { discordId: member.id } });
      if (sender && ['ADMIN', 'OWNER'].includes(sender.role)) return;

      const result = await checkUserAvatar(member);
      if (result.match) {
        console.log(`[Security] Avatar match on join for ${member.user.tag} (${result.patternName}, ${(result.similarity * 100).toFixed(1)}%)`);
        await softbanMember(member, `Using blacklisted avatar on join: ${result.patternName} (${(result.similarity * 100).toFixed(1)}% similarity)`, client);
        return;
      }

      const verifyCfg = await getVerifyConfig();
      if (verifyCfg.enabled && member.guild.id === (verifyCfg.guildId || member.guild.id)) {
        const needsRenewal = await memberNeedsVerificationRenewal(member.id);
        if (needsRenewal) {
          await resetMemberForVerificationRenewal(
            member,
            verifyCfg,
            'Guild rejoin — verification renewal required'
          );
          sendGuildJoinWelcomeDm(member, true).catch((e) => {
            console.warn('[GuildJoinWelcome] rejoin DM error:', e.message);
          });
        } else if (!member.roles.cache.has(verifyCfg.verifiedRoleId)) {
          await member.roles.add(verifyCfg.unverifiedRoleId, 'OpenSteam verification required').catch((e) => {
            console.warn('[Verify] Failed to add unverified role:', e.message);
          });
          sendGuildJoinWelcomeDm(member, false).catch((e) => {
            console.warn('[GuildJoinWelcome] join DM error:', e.message);
          });
        }
      }

      // Notify backend that user rejoined (marks discordMemberStatus=active, keys still paused until verified)
      try {
        const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
        const secret = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
        const appUrl = uploadServerUrl();
        await fetch(`${appUrl}/api/admin/bot/sync-guild-rejoin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ discordId: member.id, verified: false }),
        }).catch(() => {});
        console.log(`[GuildRejoin] ${member.user.tag} (${member.id}) rejoined — awaiting verification to restore API keys`);
      } catch (_) {}
    } catch (err) {
      console.error('[Security] guildMemberAdd avatar check error:', err.message);
    }
  });

  client.on('guildMemberRemove', async (member) => {
    if (member.user.bot) return;
    try {
      const verifyCfg = await getVerifyConfig();
      const targetGuildId = verifyCfg.guildId || member.guild.id;
      if (member.guild.id !== targetGuildId) return;

      const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
      const secret = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
      const appUrl = uploadServerUrl();

      const res = await fetch(`${appUrl}/api/admin/bot/sync-guild-leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ discordId: member.id }),
      }).catch((e) => {
        console.error('[Verify] sync-guild-leave API error:', e.message);
        return null;
      });

      if (res?.ok) {
        const data = await res.json().catch(() => ({}));
        console.log(`[GuildLeave] ${member.user.tag} (${member.id}) — session revoked=${data.revoked}, API keys paused=${data.apiKeysPaused ?? 0}`);
      }
    } catch (err) {
      console.error('[Verify] guildMemberRemove error:', err.message);
    }
  });

  // --- Profile sync + avatar scan when a member updates their profile ---
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.user.bot) return;

    // --- Track tenure of promotion-relevant roles (Moderator / Senior / Head Moderator) ---
    try {
      const TRACKED_ROLE_IDS = [
        '1484966440376467687', // Moderator
        '1521098101715374190', // Senior Moderator
        '1503424839422316574', // Head Moderator
      ];
      for (const roleId of TRACKED_ROLE_IDS) {
        const had = oldMember.roles.cache.has(roleId);
        const has = newMember.roles.cache.has(roleId);
        if (had === has) continue;
        if (has) {
          await prisma.discordRoleTenure.upsert({
            where: { discordId_roleId: { discordId: newMember.id, roleId } },
            update: { since: new Date(), removedAt: null, source: 'bot' },
            create: { discordId: newMember.id, roleId, since: new Date(), source: 'bot' },
          });
          console.log(`[Tenure] ${newMember.id} gained role ${roleId}`);
        } else {
          await prisma.discordRoleTenure.updateMany({
            where: { discordId: newMember.id, roleId, removedAt: null },
            data: { removedAt: new Date() },
          });
          console.log(`[Tenure] ${newMember.id} lost role ${roleId}`);
        }
      }
    } catch (err) {
      console.error('[Tenure] guildMemberUpdate role diff error:', err.message);
    }

    // --- Restore API keys when user gains the verified role after rejoining ---
    try {
      const verifyCfg = await getVerifyConfig();
      const verifiedRoleId = verifyCfg.verifiedRoleId;
      if (verifiedRoleId) {
        const hadVerified = oldMember.roles.cache.has(verifiedRoleId);
        const hasVerified = newMember.roles.cache.has(verifiedRoleId);
        if (!hadVerified && hasVerified) {
          // User just gained the verified role — restore their suspended API keys
          const tokenConfig = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
          const secret = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
          const appUrl = uploadServerUrl();
          const res = await fetch(`${appUrl}/api/admin/bot/sync-guild-rejoin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
            body: JSON.stringify({ discordId: newMember.id, verified: true }),
          }).catch(() => null);
          if (res?.ok) {
            const data = await res.json().catch(() => ({}));
            console.log(`[GuildVerify] ${newMember.user.tag} (${newMember.id}) verified — ${data.apiKeysRestored ?? 0} API key(s) restored`);
          }
        }
      }
    } catch (err) {
      console.error('[GuildVerify] verified role restore error:', err.message);
    }


    if (oldMember.user.username !== newMember.user.username) {
      try {
        const updated = await prisma.user.updateMany({
          where: { discordId: newMember.id },
          data: { username: newMember.user.username },
        });
        if (updated.count > 0) {
          console.log(`[Profile] Synced username for ${newMember.id}: ${oldMember.user.username} -> ${newMember.user.username}`);
        }
      } catch (err) {
        console.error('[Profile] guildMemberUpdate username sync error:', err.message);
      }
    }

    // Only recheck avatar security if the avatar actually changed
    const oldAvatar = oldMember.user.displayAvatarURL({ forceStatic: true, extension: 'png', size: 128 });
    const newAvatar = newMember.user.displayAvatarURL({ forceStatic: true, extension: 'png', size: 128 });
    if (oldAvatar === newAvatar) return;

    // Invalidate cached entry so the new avatar is always fetched fresh
    checkedAvatarsCache.delete(newMember.id);

    try {
      const sender = await prisma.user.findUnique({ where: { discordId: newMember.id } });
      if (sender && ['ADMIN', 'OWNER'].includes(sender.role)) return;

      const result = await checkUserAvatar(newMember);
      if (result.match) {
        console.log(`[Security] Avatar match after update for ${newMember.user.tag} (${result.patternName}, ${(result.similarity * 100).toFixed(1)}%)`);
        await softbanMember(newMember, `Changed to blacklisted avatar: ${result.patternName} (${(result.similarity * 100).toFixed(1)}% similarity)`, client);
      }
    } catch (err) {
      console.error('[Security] guildMemberUpdate avatar check error:', err.message);
    }
  });

  // --- Image scan on message update (catches Discord-delayed embed images) ---
  client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;

    // Only care about embed changes (that's what Discord delays)
    const hadEmbeds = oldMessage.embeds?.length ?? 0;
    const hasEmbeds = newMessage.embeds?.length ?? 0;
    if (hasEmbeds === 0 || hasEmbeds === hadEmbeds) return;

    try {
      const sender = await prisma.user.findUnique({ where: { discordId: newMessage.author.id } });
      if (sender && ['ADMIN', 'OWNER'].includes(sender.role)) return;

      const member = newMessage.member || await newMessage.guild.members.fetch(newMessage.author.id).catch(() => null);
      if (!member) return;

      for (const embed of newMessage.embeds) {
        const imageUrl = embed.image?.url || embed.thumbnail?.url;
        if (!imageUrl) continue;
        const checkResult = await checkImageSimilarity(imageUrl);
        if (checkResult.match) {
          console.log(`[Security] Embed image match on messageUpdate from ${newMessage.author.tag} (${checkResult.patternName}, ${(checkResult.similarity * 100).toFixed(1)}%)`);
          await softbanMember(member, `Matched malicious embed image (delayed): ${checkResult.patternName} (${(checkResult.similarity * 100).toFixed(1)}% similarity)`, client);
          return;
        }
      }
    } catch (err) {
      console.error('[Security] messageUpdate image check error:', err.message);
    }
  });

  // Resilient login: retry with backoff so a transient failure (network blip,
  // Discord 5xx) doesn't crash the daemon right after boot.
  const loginWithRetry = async (token) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.login(token);
        return;
      } catch (err) {
        const wait = Math.min(60_000, 5_000 * attempt);
        console.error(`[Bot Daemon] Login attempt ${attempt} failed: ${err?.message || err}. Retrying in ${wait / 1000}s…`);
        try { logToBetterStack(`Bot login attempt ${attempt} failed: ${err?.message || err}`, 'ERROR'); } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  };

  await loginWithRetry(activeBot.token);

  // Poll guild token — only reconnect when primary/backup guild token changes, not DM failover.
  let currentToken = activeBot.token;
  setInterval(async () => {
    try {
      const next = await resolveGuildBotToken();
      if (next?.token && next.token !== currentToken) {
        console.warn(`[Bot Manager] Guild bot token changed (${next.source}) — reconnecting Gateway...`);
        currentToken = next.token;
        await client.destroy().catch(() => {});
        await client.login(next.token);
      }
    } catch (err) {
      console.warn('[Bot Manager] Failover poll error:', err.message);
    }
  }, 60_000);

  // --- Automated Suspension Waves ---
  // Runs every 10 minutes to auto-ban or revoke keys for risky users and excessive scrapers based on generation history.
  setInterval(async () => {
    try {
      // 1. Full Bans (Risk Score >= 150)
      const usersToBan = await prisma.user.findMany({
        where: { riskScore: { gte: 150 }, isBanned: false },
        select: { id: true, riskScore: true }
      });

      for (const user of usersToBan) {
        await prisma.user.update({ where: { id: user.id }, data: { isBanned: true } });
        await prisma.apiKey.updateMany({ where: { userId: user.id }, data: { enabled: false } });
        await prisma.sentinelLog.create({
          data: { userId: user.id, action: 'AUTO_BAN', score: user.riskScore, reason: `Automated ban due to high risk score (${user.riskScore})` }
        }).catch(() => {});
        console.log(`[Suspension Wave] Banned user ${user.id} with risk score ${user.riskScore}`);
      }

      // 2. Key Revocations (Risk Score >= 100 and < 150)
      const usersToRevoke = await prisma.user.findMany({
        where: { riskScore: { gte: 100, lt: 150 }, isBanned: false },
        select: { id: true, riskScore: true }
      });

      for (const user of usersToRevoke) {
        const result = await prisma.apiKey.updateMany({
          where: { userId: user.id, enabled: true },
          data: { enabled: false }
        });
        if (result.count > 0) {
          await prisma.sentinelLog.create({
            data: { userId: user.id, action: 'AUTO_KEY_REVOKE', score: user.riskScore, reason: `Automated key revocation due to risk score (${user.riskScore})` }
          }).catch(() => {});
          await prisma.user.update({ where: { id: user.id }, data: { riskScore: 0 } });
          console.log(`[Suspension Wave] Revoked ${result.count} keys for user ${user.id}`);
        }
      }

      // 3. Scraping Detection via Generation History ("gens history")
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      // 3a. Check Web Generations
      const webGens = await prisma.webGeneration.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: oneHourAgo } },
        _count: { userId: true }
      });
      for (const record of webGens) {
        if (record._count.userId > 500) { // More than 500 web gens per hour is likely a scraping script
          const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { riskScore: true, isBanned: false } });
          if (user && !user.isBanned) {
            await prisma.user.update({ where: { id: record.userId }, data: { riskScore: (user.riskScore || 0) + 100 } });
            await prisma.sentinelLog.create({
              data: { userId: record.userId, action: 'RISK_LOG', score: 100, reason: `Excessive web generations detected (${record._count.userId}/hr)` }
            }).catch(() => {});
          }
        }
      }

      // 3b. Check API Usage 
      const apiGens = await prisma.apiUsage.groupBy({
        by: ['apiKeyId'],
        where: { createdAt: { gte: oneHourAgo }, endpoint: { contains: 'generate' } },
        _count: { apiKeyId: true }
      });
      for (const record of apiGens) {
        if (record._count.apiKeyId > 2000) { // Large API bursts bypassing standard limits via multiple IPs
          const apiKey = await prisma.apiKey.findUnique({ where: { id: record.apiKeyId }, select: { userId: true, user: { select: { riskScore: true, isBanned: false } } } });
          if (apiKey && !apiKey.user.isBanned) {
            await prisma.user.update({ where: { id: apiKey.userId }, data: { riskScore: (apiKey.user.riskScore || 0) + 100 } });
            await prisma.sentinelLog.create({
              data: { userId: apiKey.userId, action: 'RISK_LOG', score: 100, reason: `Excessive API generations detected (${record._count.apiKeyId}/hr)` }
            }).catch(() => {});
          }
        }
      }

    } catch (err) {
      console.error('[Suspension Wave] Error:', err.message);
    }
  }, 10 * 60 * 1000); // 10 minutes
}

async function sendSystemEmbeds(client, embeds, content) {
  try {
    const alertChannelCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_ALERTS_CHANNEL_ID' } });
    if (!alertChannelCfg?.value) return;

    const channel = await client.channels.fetch(alertChannelCfg.value);
    if (channel) {
      const payload = { embeds: Array.isArray(embeds) ? embeds : [embeds] };
      if (content) payload.content = content;
      await channel.send(payload);
    }
  } catch (e) {
    console.error('[Bot Alert Error]', e);
  }
}

async function sendSystemAlert(client, message) {
  try {
    const alertChannelCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_ALERTS_CHANNEL_ID' } });
    if (!alertChannelCfg?.value) return;

    const channel = await client.channels.fetch(alertChannelCfg.value);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('🛰️ System Log')
        .setDescription(message)
        .setColor(0x00aaff)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error('[Bot Alert Error]', e);
  }
}

async function triggerModeratorReviewFlow(guild, reporter, targetMessage, targetUser, content, messageUrl, proofUrl, triggerSource) {
  try {
    const reportsChannel = await getReportsChannel(guild);
    if (!reportsChannel) {
      if (typeof triggerSource.reply === 'function') {
        await triggerSource.reply({ content: '❌ **Error**: Reports channel not configured or not found. Please contact server administration.', flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await triggerSource.channel.send(`❌ **Error**: Reports channel not configured or not found.`).catch(() => {});
      }
      return;
    }

    // Generate unique Report ID
    const reportId = Math.random().toString(36).substring(2, 9);

    // Store in global cache dictionary
    global.activeReports = global.activeReports || new Map();
    global.activeReports.set(reportId, {
      id: reportId,
      reporterId: reporter.id,
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      messageContent: content || '[No text content]',
      messageUrl: messageUrl,
      proofUrl: proofUrl || null,
      messageId: targetMessage.id,
      channelId: targetMessage.channelId
    });

    const staffPing = getModeratorRoleMention(guild);

    const embed = new EmbedBuilder()
      .setTitle('🚨 User Message Report')
      .setDescription(`A message has been reported for review. Please approve or decline action.`)
      .setColor(0xef4444)
      .addFields(
        { name: '👤 Reporter', value: `<@${reporter.id}> (\`${reporter.username}\`)`, inline: true },
        { name: '👤 Reported Member', value: `<@${targetUser.id}> (\`${targetUser.username}\`)`, inline: true },
        { name: '💬 Content Preview', value: content ? (content.length > 1024 ? content.slice(0, 1021) + '...' : content) : '*No text content*' },
        { name: '🔗 Jump to context', value: `[Link to Message](${messageUrl})` }
      )
      .setTimestamp();

    if (proofUrl) {
      embed.setImage(proofUrl);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`report_accept_${reportId}`)
        .setLabel('Accept ✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`report_decline_${reportId}`)
        .setLabel('Decline ❌')
        .setStyle(ButtonStyle.Danger)
    );

    await reportsChannel.send({
      content: `${staffPing} 🚨 **New Report Submitted!**`,
      embeds: [embed],
      components: [row]
    });

    if (triggerSource.deferred || triggerSource.replied) {
      await triggerSource.followUp({ content: '✅ **Report Submitted**: Moderators have been notified for review.', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (typeof triggerSource.reply === 'function') {
      await triggerSource.reply({ content: '✅ **Report Submitted**: Moderators have been notified for review.', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await triggerSource.reply({ content: '✅ Thank you! The message has been reported and sent to moderators for review.' }).catch(() => {});
    }

  } catch (err) {
    console.error('[Trigger Review Error]', err.message);
  }
}

async function getReportsChannel(guild) {
  const alertChannelCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_ALERTS_CHANNEL_ID' } });
  if (alertChannelCfg?.value) {
    const channel = await guild.channels.fetch(alertChannelCfg.value).catch(() => null);
    if (channel) return channel;
  }
  const reportsChannel = guild.channels.cache.find(c => c.name === 'reports' || c.name === 'moderator-alerts' || c.name === 'alerts');
  if (reportsChannel) return reportsChannel;
  return guild.channels.cache.find(c => c.type === 0);
}

function getModeratorRoleMention(guild) {
  const role = guild.roles.cache.find(r => 
    ['moderator', 'moderators', 'staff', 'admin', 'admins'].includes(r.name.toLowerCase())
  );
  return role ? `<@&${role.id}>` : '@here';
}

function getWebDailyLimit(plan) {
  switch (plan) {
    case 'REGULAR': return 100;
    case 'PREMIUM': return 500;
    case 'RESELLER': return 1500;
    case 'BUSINESS': return 3000;
    case 'CUSTOM': return 5000;
    default: return 25;  // FREE
  }
}

const { cleanManifestZip } = require('./lib/clean-manifest');
const { getGenAppIdFromInteraction } = require('./lib/steam-app-id.js');

async function fetchExternalManifest(appId) {
  const appIdParam = encodeURIComponent(String(appId));
  const looksLikeZip = (buffer) => {
    if (!buffer || buffer.length < 1000) return false;
    const head = buffer.slice(0, 4).toString('utf8');
    if (head.startsWith('PK')) return true;
    const preview = buffer.slice(0, 200).toString('utf8').toLowerCase();
    return !preview.includes('<html') && !preview.includes('"error"') && !preview.includes('"message"');
  };

  const errors = [];

  const tryRyuu = async () => {
    const ryuuKey = await getBotConfigValue('RYUU_API_KEY');
    if (!ryuuKey) return { success: false, error: 'RYUU_API_KEY missing' };
    const ryuuRequests = [
      {
        url: `https://generator.ryuu.lol/secure_download?appid=${appIdParam}&auth_code=${encodeURIComponent(ryuuKey)}`,
        headers: {},
      },
      {
        url: `https://generator.ryuu.lol/api/download/${appIdParam}?file_type=manifest`,
        headers: { 'X-Auth-Key': ryuuKey },
      },
      {
        url: `https://generator.ryuu.lol/api/download/${appIdParam}?file_type=manifest&auth_key=${encodeURIComponent(ryuuKey)}`,
        headers: { 'X-Auth-Key': ryuuKey },
      },
    ];

    let lastError = 'not found';
    for (const req of ryuuRequests) {
      try {
        const res = await axios.get(req.url, {
          responseType: 'arraybuffer',
          timeout: 12000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'OpenSteam/1.0', ...req.headers }
        });
        const buffer = Buffer.from(res.data || []);
        if (res.status >= 200 && res.status < 300 && looksLikeZip(buffer)) {
          const cleaned = await cleanManifestZip(buffer);
          return { success: true, zipBuffer: cleaned, source: 'RYUU' };
        }
        lastError = `status ${res.status}`;
      } catch (e) {
        lastError = e?.message || 'request failed';
      }
    }
    return { success: false, error: lastError };
  };

  const tryMorrenus = async () => {
    const morKey = await getBotConfigValue('MORRENUS_API_KEY');
    if (!morKey) return { success: false, error: 'MORRENUS_API_KEY missing' };
    const morrenusRequests = [
      {
        url: `https://hubcapmanifest.com/api/v1/manifest/${appIdParam}`,
        headers: { 'X-API-Key': morKey, Authorization: `Bearer ${morKey}` },
      },
      {
        url: `https://hubcapmanifest.com/api/v1/manifest/${appIdParam}?api_key=${encodeURIComponent(morKey)}`,
        headers: {},
      },
    ];

    let lastError = 'not found';
    for (const req of morrenusRequests) {
      try {
        const res = await axios.get(req.url, {
          responseType: 'arraybuffer',
          timeout: 12000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'OpenSteam/1.0', ...req.headers }
        });
        const buffer = Buffer.from(res.data || []);
        if (res.status >= 200 && res.status < 300 && looksLikeZip(buffer)) {
          const cleaned = await cleanManifestZip(buffer);
          return { success: true, zipBuffer: cleaned, source: 'MORRENUS' };
        }
        lastError = `status ${res.status}`;
      } catch (e) {
        lastError = e?.message || 'request failed';
      }
    }
    return { success: false, error: lastError };
  };

  const tryDepotBox = async () => {
    const depotBoxKey = await getBotConfigValue('DEPOTBOX_API_KEY');
    if (!depotBoxKey) return { success: false, error: 'DEPOTBOX_API_KEY missing' };
    try {
      const result = await fetchManifestFromDepotBox(appId, await getDepotBoxFetchOptions());
      if (result.success && result.zipBuffer) {
        return { success: true, zipBuffer: result.zipBuffer, source: 'DEPOTBOX' };
      }
      return { success: false, error: result.error || 'not found' };
    } catch (e) {
      console.warn('[Autogen] DepotBox fetch failed:', e?.message || e);
      return { success: false, error: e?.message || 'request failed' };
    }
  };

  const fetchers = {
    ryuu: tryRyuu,
    morrenus: tryMorrenus,
    depotbox: tryDepotBox,
  };
  const fallbackDelayMs = {
    morrenus: 750,
    depotbox: 1500,
  };
  let attemptedProvider = false;

  for (const provider of await getAutogenProviderOrder()) {
    if (attemptedProvider && fallbackDelayMs[provider]) {
      await new Promise((resolve) => setTimeout(resolve, fallbackDelayMs[provider]));
    }
    const result = await fetchers[provider]();
    attemptedProvider = true;
    if (result.success && result.zipBuffer) return result;
    errors.push(`${provider}: ${result.error || 'not found'}`);
  }

  return { success: false, error: `Not found in upstream providers (${errors.join('; ')}).` };
}

startBot().catch(err => {
  console.error('Fatal Bot Error:', err);
  process.exit(1);
});
