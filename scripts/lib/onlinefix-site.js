const axios = require('axios');
const {
  parseOnlineFixDisplayName,
  steamHeaderImageUrl,
} = require('./onlinefix-s3');
const { searchSteamStoreByName } = require('./steam-app-list');

const OFFICIAL_SITE = 'https://online-fix.me';
const OFFICIAL_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
const OFFICIAL_MAX_PAGES = 70;

let lastOfficialSyncAt = 0;

function normalizeOnlineFixKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

async function fetchOfficialHtml(url) {
  const res = await axios.get(url, {
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenSteam/1.0',
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (res.status < 200 || res.status >= 400) {
    throw new Error(`online-fix.me returned HTTP ${res.status} for ${url}`);
  }
  return String(res.data || '');
}

function parseOfficialArticles(html) {
  const games = [];
  const blocks = html.match(/<article class="news">[\s\S]*?<\/article>/gi) || [];

  for (const block of blocks) {
    const pageUrl = block.match(/href="(https:\/\/online-fix\.me\/games\/[^"]+)"/i)?.[1];
    const imageUrl =
      block.match(/data-src="(https:\/\/online-fix\.me\/uploads\/[^"]+)"/i)?.[1] ||
      block.match(/src="(https:\/\/online-fix\.me\/uploads\/[^"]+)"/i)?.[1];
    const rawTitle =
      block.match(/<h2[^>]*>\s*<a[^>]*>([^<]+)/i)?.[1]?.replace(/\s+/g, ' ').trim() ||
      block.match(/<img[^>]+alt="([^"]+)"/i)?.[1]?.replace(/\s+/g, ' ').trim() ||
      '';

    if (!pageUrl || !rawTitle) continue;

    const title = parseOnlineFixDisplayName(rawTitle, null);
    if (!title || title === 'Unknown Game') continue;

    games.push({
      pageUrl,
      imageUrl: imageUrl || null,
      rawTitle,
      title,
      key: normalizeOnlineFixKey(title),
    });
  }

  return games;
}

async function scrapeOfficialSiteCatalog({ maxPages = OFFICIAL_MAX_PAGES } = {}) {
  const byKey = new Map();
  const pageUrls = [`${OFFICIAL_SITE}/`, `${OFFICIAL_SITE}/games/`];

  for (let page = 1; page <= maxPages; page += 1) {
    pageUrls.push(`${OFFICIAL_SITE}/games/page/${page}/`);
  }

  for (const url of pageUrls) {
    try {
      const html = await fetchOfficialHtml(url);
      const parsed = parseOfficialArticles(html);
      if (parsed.length === 0 && url.includes('/games/page/')) {
        break;
      }
      for (const game of parsed) {
        if (!game.key) continue;
        if (!byKey.has(game.key)) {
          byKey.set(game.key, game);
        }
      }
    } catch (err) {
      if (url.includes('/games/page/')) break;
      console.warn('[OnlineFix Site] Page fetch failed:', url, err.message);
    }
  }

  return Array.from(byKey.values());
}

async function syncOnlineFixIndexFromOfficialSite({ prismaClient, maxPages } = {}) {
  const db = prismaClient;
  if (!db) throw new Error('prismaClient is required for official site sync');

  const officialGames = await scrapeOfficialSiteCatalog({ maxPages });
  const dbGames = await db.onlineFixGame.findMany({
    select: { id: true, name: true, fileName: true, imageUrl: true, sourceUrl: true },
  });

  const dbByKey = new Map();
  for (const game of dbGames) {
    const key = normalizeOnlineFixKey(parseOnlineFixDisplayName(game.name, game.fileName));
    if (key) dbByKey.set(key, game);
  }

  let updated = 0;
  for (const official of officialGames) {
    const existing = dbByKey.get(official.key);
    if (!existing) continue;

    await db.onlineFixGame.update({
      where: { id: existing.id },
      data: {
        imageUrl: official.imageUrl || existing.imageUrl,
        sourceUrl: official.pageUrl,
        indexedAt: new Date(),
      },
    });
    updated += 1;
  }

  lastOfficialSyncAt = Date.now();
  return { found: officialGames.length, updated };
}

async function normalizeOnlineFixCatalogNames({ prismaClient } = {}) {
  const db = prismaClient;
  if (!db) return { updated: 0 };

  const rows = await db.onlineFixGame.findMany({
    select: { id: true, name: true, fileName: true },
  });

  let updated = 0;
  for (const row of rows) {
    const cleanName = parseOnlineFixDisplayName(row.name, row.fileName);
    if (!cleanName || cleanName === row.name) continue;
    await db.onlineFixGame.update({
      where: { id: row.id },
      data: { name: cleanName },
    });
    updated += 1;
  }

  return { updated };
}

const steamImageCache = new Map();

async function resolveSteamImagesForCatalog({ prismaClient, limit = 120 } = {}) {
  const db = prismaClient;
  if (!db) return { updated: 0 };

  const rows = await db.onlineFixGame.findMany({
    where: {
      OR: [{ imageUrl: null }, { imageUrl: '' }],
    },
    select: { id: true, name: true, fileName: true, steamAppId: true },
    take: limit,
  });

  let updated = 0;
  for (const row of rows) {
    const title = parseOnlineFixDisplayName(row.name, row.fileName);
    if (!title) continue;

    let appId = row.steamAppId;
    if (!appId) {
      if (steamImageCache.has(title)) {
        appId = steamImageCache.get(title);
      } else {
        const hits = await searchSteamStoreByName(title);
        const hit =
          hits.find((h) => normalizeOnlineFixKey(h.name) === normalizeOnlineFixKey(title)) ||
          hits.find((h) => h.name?.toLowerCase().includes(title.toLowerCase())) ||
          hits[0];
        appId = hit?.appid || null;
        steamImageCache.set(title, appId);
      }
    }

    if (!appId) continue;

    await db.onlineFixGame.update({
      where: { id: row.id },
      data: {
        steamAppId: appId,
        imageUrl: steamHeaderImageUrl(appId),
      },
    });
    updated += 1;
  }

  return { updated };
}

function shouldRefreshOfficialSite() {
  return Date.now() - lastOfficialSyncAt > OFFICIAL_SYNC_TTL_MS;
}

module.exports = {
  OFFICIAL_SITE,
  normalizeOnlineFixKey,
  scrapeOfficialSiteCatalog,
  syncOnlineFixIndexFromOfficialSite,
  normalizeOnlineFixCatalogNames,
  resolveSteamImagesForCatalog,
  shouldRefreshOfficialSite,
};
