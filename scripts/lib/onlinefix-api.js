const axios = require('axios');

const LIST_CACHE_TTL_MS = 5 * 60 * 1000;
let listCache = { fetchedAt: 0, games: [] };

function getOnlineFixApiConfig() {
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.PUBLIC_APP_URL ||
    'http://127.0.0.1:3000'
  ).replace(/\/$/, '');
  const apiKey = process.env.ADMIN_API_KEY?.trim();
  return { baseUrl, apiKey };
}

function buildOnlineFixApiHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
  };
}

async function fetchOnlineFixList({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && listCache.games.length > 0 && now - listCache.fetchedAt < LIST_CACHE_TTL_MS) {
    return listCache.games;
  }

  const { baseUrl, apiKey } = getOnlineFixApiConfig();
  if (!apiKey) {
    throw new Error('ADMIN_API_KEY is not configured for OnlineFix API access.');
  }

  const res = await axios.get(`${baseUrl}/api/v2/onlinefix/list`, {
    headers: buildOnlineFixApiHeaders(apiKey),
    timeout: 60000,
    validateStatus: () => true,
  });

  if (res.status !== 200 || !res.data?.success) {
    throw new Error(res.data?.error || `OnlineFix list request failed (${res.status}).`);
  }

  listCache = {
    fetchedAt: now,
    games: Array.isArray(res.data.games) ? res.data.games : [],
  };
  return listCache.games;
}

function searchOnlineFixGames(games, query, { limit = 25, orderBySearch = false } = {}) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return [...games]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  const matches = games.filter((game) => game.name?.toLowerCase().includes(normalized));
  matches.sort((a, b) => {
    if (orderBySearch) {
      const searchDiff = (b.searches || 0) - (a.searches || 0);
      if (searchDiff !== 0) return searchDiff;
    }
    return a.name.localeCompare(b.name);
  });
  return matches.slice(0, limit);
}

async function searchOnlineFixViaApi(query, options = {}, { prismaClient } = {}) {
  try {
    const games = await fetchOnlineFixList(options);
    return searchOnlineFixGames(games, query, options);
  } catch (err) {
    if (!prismaClient) throw err;
    console.warn('[OnlineFix] API list failed, using database fallback:', err.message);
    const games = await prismaClient.onlineFixGame.findMany({
      select: {
        name: true,
        fileName: true,
        fileSize: true,
        searches: true,
        lastUpdated: true,
      },
      orderBy: { name: 'asc' },
    });
    return searchOnlineFixGames(games, query, options);
  }
}

async function resolveOnlineFixDownloadUrl(gameName) {
  const { baseUrl, apiKey } = getOnlineFixApiConfig();
  if (!apiKey) {
    throw new Error('ADMIN_API_KEY is not configured for OnlineFix API access.');
  }

  const encodedName = encodeURIComponent(String(gameName || '').trim());
  if (!encodedName) return null;

  const res = await axios.get(`${baseUrl}/api/v2/onlinefix/download/${encodedName}`, {
    headers: buildOnlineFixApiHeaders(apiKey),
    maxRedirects: 0,
    timeout: 30000,
    validateStatus: (status) => status === 302 || status === 404 || (status >= 400 && status < 500),
  });

  if (res.status === 302) {
    const location = res.headers?.location;
    if (!location) return null;
    if (/^https?:\/\//i.test(location)) return location;
    return `${baseUrl}${location.startsWith('/') ? '' : '/'}${location}`;
  }

  if (res.status === 404) return null;

  const message =
    typeof res.data === 'object' && res.data?.error
      ? res.data.error
      : `OnlineFix download request failed (${res.status}).`;
  throw new Error(message);
}

async function downloadOnlineFixArchive(gameName, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const downloadUrl = await resolveOnlineFixDownloadUrl(gameName);
  if (!downloadUrl) return null;

  const fileRes = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    maxContentLength: maxBytes + 1,
    timeout: 120000,
    validateStatus: () => true,
  });

  if (fileRes.status !== 200 || !fileRes.data) return null;

  const buffer = Buffer.from(fileRes.data);
  if (buffer.length > maxBytes) return null;

  const fileName = decodeURIComponent(
    String(downloadUrl).split('/').pop()?.split('?')[0] || `${gameName}.rar`
  );

  return {
    buffer,
    fileName,
    contentLength: buffer.length,
    downloadUrl,
  };
}

function clearOnlineFixListCache() {
  listCache = { fetchedAt: 0, games: [] };
}

module.exports = {
  fetchOnlineFixList,
  searchOnlineFixGames,
  searchOnlineFixViaApi,
  resolveOnlineFixDownloadUrl,
  downloadOnlineFixArchive,
  clearOnlineFixListCache,
};
