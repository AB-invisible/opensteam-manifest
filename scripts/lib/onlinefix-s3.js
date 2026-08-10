const { PrismaClient } = require('@prisma/client');
const { S3Client, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

let prisma;

function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

const ONLINEFIX_ARCHIVE_EXTENSIONS = ['.rar', '.zip'];

// Memory cache for configs to avoid DB hits on every request
let cachedConfig = null;
let cachedClient = null;
let lastCacheTime = 0;

async function getOnlineFixS3Config() {
  const now = Date.now();
  if (cachedConfig && cachedClient && (now - lastCacheTime < 60000)) {
    return { config: cachedConfig, s3Client: cachedClient };
  }

  const db = getPrismaClient();
  const keys = [
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
    'AWS_DEFAULT_REGION', 'AWS_ENDPOINT_URL', 'AWS_S3_BUCKET_NAME',
    'ONLINEFIX_S3_PREFIX'
  ];

  let dbMap = new Map();
  try {
    const rows = await db.systemConfig.findMany({ where: { key: { in: keys } } });
    for (const r of rows) dbMap.set(r.key, r.value);
  } catch (err) {
    // If DB fails (e.g. during build), fallback to process.env silently
  }

  const config = {
    accessKeyId: dbMap.get('AWS_ACCESS_KEY_ID') || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: dbMap.get('AWS_SECRET_ACCESS_KEY') || process.env.AWS_SECRET_ACCESS_KEY || '',
    region: dbMap.get('AWS_DEFAULT_REGION') || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    endpointUrl: dbMap.get('AWS_ENDPOINT_URL') || process.env.AWS_ENDPOINT_URL,
    bucketName: dbMap.get('AWS_S3_BUCKET_NAME') || process.env.AWS_S3_BUCKET_NAME,
    prefix: dbMap.get('ONLINEFIX_S3_PREFIX') || process.env.ONLINEFIX_S3_PREFIX || 'OnlineFixes/'
  };

  const s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpointUrl,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  cachedConfig = config;
  cachedClient = s3Client;
  lastCacheTime = now;

  return { config, s3Client };
}

function normalizeS3Key(key) {
  return String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeOnlineFixPrefix(prefix) {
  const normalized = normalizeS3Key(prefix || 'OnlineFixes/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

async function onlineFixKeyForFileName(fileName) {
  const { config } = await getOnlineFixS3Config();
  const normalizedPrefix = normalizeOnlineFixPrefix(config.prefix);
  const normalized = normalizeS3Key(fileName);
  if (normalized.toLowerCase().startsWith(normalizedPrefix.toLowerCase())) {
    return normalized;
  }
  return `${normalizedPrefix}${fileNameFromS3Key(normalized)}`;
}

function encodeS3KeyForUrl(key) {
  return normalizeS3Key(key).split('/').map(encodeURIComponent).join('/');
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileNameFromS3Key(key) {
  const parts = normalizeS3Key(key).split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function isOnlineFixArchiveKey(key) {
  const lower = normalizeS3Key(key).toLowerCase();
  return ONLINEFIX_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cleanOnlineFixName(fileName) {
  let cleanName = safeDecodeURIComponent(fileNameFromS3Key(fileName))
    .replace(/\.(rar|zip)$/i, '');

  if (cleanName.includes('_Fix_Repair')) {
    cleanName = cleanName.split('_Fix_Repair')[0];
  }

  return cleanName
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatOnlineFixSize(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) {
    return 'Unknown';
  }

  const size = Number(bytes);
  if (size === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, unitIndex);
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;

  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

async function getOnlineFixS3Url(key) {
  const { config, s3Client } = await getOnlineFixS3Config();
  if (!config.bucketName || !key) return null;

  try {
    // Generate a 3-hour presigned URL to allow downloading without AccessDenied errors
    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: key
    });
    
    return await getSignedUrl(s3Client, command, { expiresIn: 10800 });
  } catch (err) {
    console.error(`[OnlineFix S3] Failed to generate presigned URL for ${key}:`, err.message);
    
    // Fallback to static URL generation if presigning fails
    const encodedKey = encodeS3KeyForUrl(key);
    if (config.endpointUrl) {
      const endpoint = config.endpointUrl.endsWith('/')
        ? config.endpointUrl
        : `${config.endpointUrl}/`;
      return `${endpoint}${encodeURIComponent(config.bucketName)}/${encodedKey}`;
    }

    return `https://${config.bucketName}.s3.${config.region}.amazonaws.com/${encodedKey}`;
  }
}

async function getOnlineFixDownloadUrl(game) {
  if (!game) return null;

  const key = await onlineFixKeyForFileName(game.fileName);
  const s3Url = await getOnlineFixS3Url(key);
  if (s3Url) return s3Url;

  return game.fileUrl || null;
}

async function checkS3FileExists(key) {
  const { config, s3Client } = await getOnlineFixS3Config();
  if (!config.bucketName) return false;

  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    }));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Download an OnlineFix game file from S3 as a Buffer.
 * @param {object} game - A game row from the database (must have `fileName`).
 * @param {object} [options]
 * @param {number} [options.maxBytes=26214400] - Abort if the file is larger than this (default 25 MB).
 * @returns {Promise<{buffer: Buffer, fileName: string, contentLength: number} | null>}
 */
async function downloadOnlineFixFromS3(game, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const { config, s3Client } = await getOnlineFixS3Config();
  if (!config.bucketName || !game?.fileName) return null;

  const s3Key = await onlineFixKeyForFileName(game.fileName);

  try {
    // First check the file size with HEAD to avoid streaming huge files
    const head = await s3Client.send(new HeadObjectCommand({
      Bucket: config.bucketName,
      Key: s3Key,
    }));

    const contentLength = head.ContentLength || 0;
    if (contentLength === 0 || contentLength > maxBytes) {
      return null; // Too large or empty — caller should fall back to link
    }

    // Stream the object into a Buffer
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: config.bucketName,
      Key: s3Key,
    }));

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }

    return {
      buffer: Buffer.concat(chunks),
      fileName: game.fileName,
      contentLength,
    };
  } catch (err) {
    console.error(`[OnlineFix S3] Failed to download ${s3Key}:`, err.message);
    return null;
  }
}

async function onlineFixGameFromS3Object(object) {
  const key = normalizeS3Key(object?.Key);
  if (!key || key.endsWith('/') || !isOnlineFixArchiveKey(key)) {
    return null;
  }

  const fileName = fileNameFromS3Key(key);
  if (!fileName) return null;

  return {
    name: cleanOnlineFixName(fileName),
    fileName,
    fileUrl: await getOnlineFixS3Url(key),
    fileSize: formatOnlineFixSize(object.Size),
    lastUpdated: object.LastModified ? new Date(object.LastModified) : null,
    s3Key: key,
  };
}

async function listOnlineFixObjects(options = {}) {
  const { config, s3Client } = await getOnlineFixS3Config();
  if (!config.bucketName) {
    throw new Error('AWS_S3_BUCKET_NAME is not set.');
  }

  const prefix = options.prefix || config.prefix;
  const objects = [];
  let continuationToken;

  do {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: config.bucketName,
      Prefix: normalizeOnlineFixPrefix(prefix),
      ContinuationToken: continuationToken,
    }));

    for (const object of response.Contents || []) {
      objects.push(object);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

async function listOnlineFixGamesFromS3(options = {}) {
  const objects = await listOnlineFixObjects(options);
  const byFileName = new Map();

  for (const object of objects) {
    const game = await onlineFixGameFromS3Object(object);
    if (!game) continue;

    const existing = byFileName.get(game.fileName);
    if (!existing || !existing.lastUpdated || (game.lastUpdated && game.lastUpdated > existing.lastUpdated)) {
      byFileName.set(game.fileName, game);
    }
  }

  return Array.from(byFileName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function syncOnlineFixIndexFromS3({ prismaClient, prefix } = {}) {
  const { config } = await getOnlineFixS3Config();
  const activePrefix = prefix || config.prefix;
  const db = prismaClient || getPrismaClient();
  const games = await listOnlineFixGamesFromS3({ prefix: activePrefix });
  const now = new Date();
  let added = 0;
  let updated = 0;

  for (const game of games) {
    const existing = await db.onlineFixGame.findUnique({
      where: { fileName: game.fileName },
      select: { id: true },
    });

    const data = {
      name: game.name,
      fileName: game.fileName,
      fileUrl: game.fileUrl,
      fileSize: game.fileSize,
      lastUpdated: game.lastUpdated,
      indexedAt: now,
    };

    if (existing) {
      await db.onlineFixGame.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
    } else {
      await db.onlineFixGame.create({ data });
      added += 1;
    }
  }

  return {
    prefix: normalizeOnlineFixPrefix(activePrefix),
    found: games.length,
    added,
    updated,
  };
}

async function scrapePeronDepotGames() {
  const response = await axios.get('https://api.perondepot.xyz/', { timeout: 15000 });
  const html = String(response.data || '');
  const lines = html.split('\n');
  const scrapedGames = [];

  for (const line of lines) {
    if (!line.trim() || !line.includes('<a href="')) continue;

    const hrefStart = line.indexOf('<a href="') + 9;
    const hrefEnd = line.indexOf('"', hrefStart);
    if (hrefStart === 8 || hrefEnd === -1) continue;

    const href = line.substring(hrefStart, hrefEnd);
    const textStart = line.indexOf('>', hrefEnd) + 1;
    const textEnd = line.indexOf('<', textStart);
    if (textStart === 0 || textEnd === -1) continue;

    const archiveName = line.substring(textStart, textEnd).trim();
    if (!archiveName || archiveName.includes('..') || archiveName.includes('docker') || archiveName.includes('nginx')) continue;
    if (!archiveName.endsWith('.rar') && !archiveName.endsWith('.zip')) continue;

    const cleanName = archiveName.replace(/\.(rar|zip)$/i, '').replace(/_/g, ' ').trim();
    const sizeMatch = line.substring(textEnd).match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|K|M|G|T)/i);

    scrapedGames.push({
      name: cleanName,
      fileName: archiveName,
      fileUrl: `https://api.perondepot.xyz/${href}`,
      fileSize: sizeMatch ? sizeMatch[0] : 'Unknown',
    });
  }

  return scrapedGames;
}

async function syncOnlineFixIndexFromPeronDepot({ prismaClient } = {}) {
  const db = prismaClient || getPrismaClient();
  const scrapedGames = await scrapePeronDepotGames();
  const now = new Date();
  let added = 0;
  let updated = 0;

  for (const game of scrapedGames) {
    const existing = await db.onlineFixGame.findUnique({
      where: { fileName: game.fileName },
      select: { id: true, fileUrl: true },
    });

    const data = {
      name: game.name,
      fileName: game.fileName,
      fileUrl: game.fileUrl,
      fileSize: game.fileSize,
      indexedAt: now,
    };

    if (existing) {
      await db.onlineFixGame.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
    } else {
      await db.onlineFixGame.create({ data });
      added += 1;
    }
  }

  return {
    found: scrapedGames.length,
    added,
    updated,
  };
}

let catalogEnsurePromise = null;

async function ensureOnlineFixCatalog({ prismaClient } = {}) {
  const db = prismaClient || getPrismaClient();
  const existingCount = await db.onlineFixGame.count();
  if (existingCount > 0) {
    return { source: 'db', count: existingCount };
  }

  if (catalogEnsurePromise) {
    await catalogEnsurePromise.catch(() => {});
    return { source: 'pending', count: await db.onlineFixGame.count() };
  }

  catalogEnsurePromise = (async () => {
    try {
      const s3Result = await syncOnlineFixIndexFromS3({ prismaClient: db });
      const afterS3 = await db.onlineFixGame.count();
      if (afterS3 > 0) {
        return { source: 's3', count: afterS3, ...s3Result };
      }

      const depotResult = await syncOnlineFixIndexFromPeronDepot({ prismaClient: db });
      const afterDepot = await db.onlineFixGame.count();
      return { source: 'perondepot', count: afterDepot, ...depotResult };
    } finally {
      catalogEnsurePromise = null;
    }
  })();

  return catalogEnsurePromise;
}

/**
 * Streams an OnlineFix game file from PeronDepot to S3 and updates the database.
 * Designed to run asynchronously in the background.
 */
async function mirrorOnlineFixToS3(game, { prismaClient } = {}) {
  const { config, s3Client } = await getOnlineFixS3Config();
  if (!config.bucketName) {
    console.log(`[OnlineFix S3] BUCKET_NAME not set. Skipping mirror for ${game.name}.`);
    return;
  }

  const db = prismaClient || getPrismaClient();
  const s3Key = await onlineFixKeyForFileName(game.fileName);
  const finalS3Url = await getOnlineFixS3Url(s3Key);

  if (!game.fileUrl.includes('api.perondepot.xyz')) {
    if (finalS3Url && game.id) {
      await db.onlineFixGame.update({
        where: { id: game.id },
        data: { fileUrl: finalS3Url }
      }).catch(() => {});
    }
    return;
  }

  try {
    const exists = await checkS3FileExists(s3Key);
    if (exists) {
      console.log(`[OnlineFix S3] File already exists in S3 at ${s3Key}. Updating DB...`);
      await db.onlineFixGame.update({
        where: { id: game.id },
        data: { fileUrl: finalS3Url }
      });
      return;
    }

    console.log(`[OnlineFix S3] Downloading stream from PeronDepot for ${game.name}...`);
    
    const response = await axios({
      method: 'GET',
      url: game.fileUrl,
      responseType: 'stream',
      timeout: 30000,
    });

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.bucketName,
        Key: s3Key,
        Body: response.data,
      },
    });

    await upload.done();
    console.log(`[OnlineFix S3] Upload to S3 completed: ${s3Key}`);

    await db.onlineFixGame.update({
      where: { id: game.id },
      data: { fileUrl: finalS3Url }
    });
    console.log(`[OnlineFix S3] DB updated to ${finalS3Url} for ${game.name}`);

  } catch (error) {
    console.error(`[OnlineFix S3] FAILED to process ${game.name}:`, error.message);
  }
}

async function getOnlineFixBucketName() {
  const { config } = await getOnlineFixS3Config();
  return config.bucketName;
}

module.exports = {
  getOnlineFixBucketName,
  mirrorOnlineFixToS3,
  getOnlineFixS3Url,
  getOnlineFixDownloadUrl,
  downloadOnlineFixFromS3,
  checkS3FileExists,
  listOnlineFixObjects,
  listOnlineFixGamesFromS3,
  syncOnlineFixIndexFromS3,
  syncOnlineFixIndexFromPeronDepot,
  ensureOnlineFixCatalog,
  onlineFixGameFromS3Object,
  cleanOnlineFixName,
  encodeS3KeyForUrl,
  onlineFixKeyForFileName
};
