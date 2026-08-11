const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { cleanManifestZip } = require('./clean-manifest');

const steamCache = new Map();
let botS3Client = null;

const MAX_GEN_DISCORD_ZIP = 25 * 1024 * 1024;
const MAX_GEN_DISCORD_ZIP_LABEL = '25MB';

function initS3() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME) {
    botS3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
}

function getGenAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000';
}

function isPlaceholderName(name) {
  return !name || /^(Manifest|App)\s+\d+$/i.test(name);
}

function safeManifestFilename(name, appId) {
  const cleaned = (name || '').replace(/[^a-zA-Z0-9]/g, '_');
  const appIdStr = String(appId);
  if (!cleaned || cleaned === `App_${appIdStr}` || cleaned === `Manifest_${appIdStr}`) {
    return `App_${appIdStr}.zip`;
  }
  return `${cleaned}_${appIdStr}.zip`;
}

async function getCachedSteamInfo(appId) {
  if (steamCache.has(appId)) {
    const entry = steamCache.get(appId);
    if (Date.now() - entry.timestamp < 1000 * 60 * 60) return entry.data;
  }
  const STEAM_RETRY_DELAYS_MS = [0, 800, 2200];
  for (let attempt = 0; attempt < STEAM_RETRY_DELAYS_MS.length; attempt++) {
    if (STEAM_RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, STEAM_RETRY_DELAYS_MS[attempt]));
    }
    try {
      const res = await axios.get(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic&l=english&cc=us`,
        { timeout: 8000, validateStatus: () => true }
      );
      if (res.status === 429) continue;
      if (res.status < 200 || res.status >= 300) break;
      const node = res.data?.[appId];
      if (!node || node.success === false) break;
      if (node.data) {
        steamCache.set(appId, { data: node.data, timestamp: Date.now() });
        return node.data;
      }
      break;
    } catch (e) {
      /* retry */
    }
  }
  return null;
}

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
      console.warn('[Hosted Bot Gen] S3 persist failed:', e.message);
    }
  }

  const storagePath = process.env.STORAGE_PATH || path.join(__dirname, '../../data');
  const dir = path.join(storagePath, 'manifests', appIdStr);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), zipBuffer);
  return { storageType: 'local', s3Key: null };
}

async function upsertGenManifestRecord(prisma, appId, gameName, zipBuffer, userId) {
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

async function loadCachedManifestZip(appId) {
  const s3Key = `manifests/${appId}/${appId}.zip`;
  if (botS3Client && process.env.AWS_S3_BUCKET_NAME) {
    try {
      const s3Res = await botS3Client.send(new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
      }));
      const chunks = [];
      for await (const chunk of s3Res.Body) chunks.push(chunk);
      const zipBuffer = Buffer.concat(chunks);
      if (zipBuffer.length > 0 && zipBuffer.length <= MAX_GEN_DISCORD_ZIP) return zipBuffer;
    } catch (e) { /* local fallback */ }
  }

  const storagePath = process.env.STORAGE_PATH || path.join(__dirname, '../../data');
  const localZipPath = path.join(storagePath, 'manifests', appId, `${appId}.zip`);
  if (fs.existsSync(localZipPath)) {
    const stats = fs.statSync(localZipPath);
    if (stats.size > 0 && stats.size <= MAX_GEN_DISCORD_ZIP) {
      return fs.readFileSync(localZipPath);
    }
  }
  return null;
}

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
    await interaction.followUp(zipPayload);
    return { sent: true, via: 'ephemeral' };
  } catch (e) {
    try {
      await interaction.user.send({
        content: `🎁 **Your OpenSteam manifest:** ${gameName} (\`${appId}\`)\n_Sourced from \`${sourceLabel}\`._`,
        files: [attachment],
      });
      return { sent: true, via: 'dm' };
    } catch (dmErr) {
      return { sent: false, reason: dmErr.message };
    }
  }
}

async function fetchExternalManifest(appId) {
  const appIdParam = encodeURIComponent(String(appId));
  const looksLikeZip = (buffer) => {
    if (!buffer || buffer.length < 1000) return false;
    const head = buffer.slice(0, 4).toString('utf8');
    if (head.startsWith('PK')) return true;
    const preview = buffer.slice(0, 200).toString('utf8').toLowerCase();
    return !preview.includes('<html') && !preview.includes('"error"') && !preview.includes('"message"');
  };

  const morKey = process.env.MORRENUS_API_KEY;
  if (morKey) {
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

    for (const req of morrenusRequests) {
      try {
        const res = await axios.get(req.url, {
          responseType: 'arraybuffer',
          timeout: 12000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'OpenSteam/1.0', ...req.headers },
        });
        const buffer = Buffer.from(res.data || []);
        if (res.status >= 200 && res.status < 300 && looksLikeZip(buffer)) {
          const cleaned = await cleanManifestZip(buffer);
          return { success: true, zipBuffer: cleaned, source: 'MORRENUS' };
        }
      } catch (e) { /* fallback */ }
    }
  }

  const ryuuKey = process.env.RYUU_API_KEY;
  if (ryuuKey) {
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

    for (const req of ryuuRequests) {
      try {
        const res = await axios.get(req.url, {
          responseType: 'arraybuffer',
          timeout: 12000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'OpenSteam/1.0', ...req.headers },
        });
        const buffer = Buffer.from(res.data || []);
        if (res.status >= 200 && res.status < 300 && looksLikeZip(buffer)) {
          const cleaned = await cleanManifestZip(buffer);
          return { success: true, zipBuffer: cleaned, source: 'RYUU' };
        }
      } catch (e) { /* not found */ }
    }
  }

  return { success: false, error: 'Not found in any upstream provider.' };
}

function getWebDailyLimit(plan, customWebDailyLimit) {
  if (customWebDailyLimit != null) return customWebDailyLimit;
  switch (plan) {
    case 'REGULAR': return 100;
    case 'PREMIUM': return 500;
    case 'RESELLER': return 1500;
    case 'BUSINESS': return 3000;
    case 'CUSTOM': return 10000;
    default: return 25;
  }
}

function getApiDailyLimit(plan, customDailyLimit) {
  if (customDailyLimit != null) return customDailyLimit;
  switch (plan) {
    case 'REGULAR': return 1000;
    case 'PREMIUM': return 5000;
    case 'RESELLER': return 30000;
    case 'BUSINESS': return 100000;
    case 'CUSTOM': return 1000000;
    default: return 50;
  }
}

function getUtcDayBounds() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);
  return { todayStart, todayEnd };
}

/** Matches checkDailyApiQuota — successful manifest generations today for the account. */
async function countUserApiUsageToday(prisma, userId) {
  const { todayStart } = getUtcDayBounds();
  return prisma.apiUsage.count({
    where: {
      apiKey: { userId },
      createdAt: { gte: todayStart },
      status: 200,
      OR: [
        { endpoint: { contains: '/generate/' } },
        { endpoint: { endsWith: '/bulk/generate' } },
        { endpoint: '/api/manifests/generate' },
      ],
    },
  });
}

async function consumeUserApiQuota(prisma, userId, endpoint, requestedAppId) {
  const firstKey = await prisma.apiKey.findFirst({
    where: { userId, enabled: true },
    select: { id: true },
  });
  if (!firstKey) return { ok: false, code: 'NO_KEYS' };

  await prisma.apiUsage.create({
    data: {
      apiKeyId: firstKey.id,
      endpoint,
      method: 'POST',
      status: 200,
      ip: 'discord-hosted-bot',
      userAgent: 'hosted-custom-bot-gen',
      requestedAppId: requestedAppId != null ? String(requestedAppId) : undefined,
    },
  });
  return { ok: true };
}

async function countHostedGenerationsToday(prisma, hostedBotInstanceId, source) {
  const { todayStart, todayEnd } = getUtcDayBounds();
  return prisma.webGeneration.count({
    where: {
      hostedBotInstanceId,
      source,
      createdAt: { gte: todayStart, lte: todayEnd },
    },
  });
}

async function recordHostedBotGeneration(prisma, {
  purchaserUserId,
  hostedBotInstanceId,
  guildId,
  appId,
  gameName,
  source,
}) {
  return prisma.webGeneration.create({
    data: {
      userId: purchaserUserId,
      hostedBotInstanceId,
      guildId,
      appId: String(appId),
      gameName,
      source,
    },
  });
}

async function passiveBackfillManifestName(prisma, appId, realName) {
  try {
    if (!realName || isPlaceholderName(realName)) return;
    const row = await prisma.manifest.findUnique({
      where: { steamAppId: String(appId) },
      select: { id: true, name: true },
    });
    if (!row || !isPlaceholderName(row.name)) return;
    await prisma.manifest.update({
      where: { id: row.id },
      data: { name: realName.slice(0, 200) },
    });
  } catch (e) { /* ignore */ }
}

module.exports = {
  initS3,
  getGenAppUrl,
  getCachedSteamInfo,
  upsertGenManifestRecord,
  loadCachedManifestZip,
  sendGenZipToRequester,
  fetchExternalManifest,
  getWebDailyLimit,
  getApiDailyLimit,
  countUserApiUsageToday,
  consumeUserApiQuota,
  countHostedGenerationsToday,
  recordHostedBotGeneration,
  passiveBackfillManifestName,
  isPlaceholderName,
  MAX_GEN_DISCORD_ZIP,
  MAX_GEN_DISCORD_ZIP_LABEL,
  EmbedBuilder,
  HeadObjectCommand,
};
