/**
 * Steam catalogue helpers for the bot daemon (IStoreService — legacy GetAppList/v2 is gone).
 */
const axios = require('axios');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let steamAppListCache = { timestamp: 0, apps: [] };

function normalizeSteamName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveSteamApiKey(getConfigValue) {
  const env = process.env.STEAM_API_KEY?.trim();
  if (env) return env;
  if (getConfigValue) {
    const fromDb = await getConfigValue('STEAM_API_KEY', false);
    return fromDb?.trim() || null;
  }
  return null;
}

async function fetchSteamAppList(getConfigValue) {
  if (steamAppListCache.apps.length > 0 && Date.now() - steamAppListCache.timestamp < CACHE_TTL_MS) {
    return steamAppListCache.apps;
  }

  const key = await resolveSteamApiKey(getConfigValue);
  if (!key) {
    throw new Error('STEAM_API_KEY is not configured for autogen App ID resolution.');
  }

  const apps = [];
  let lastAppId = 0;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL('https://api.steampowered.com/IStoreService/GetAppList/v1/');
    url.searchParams.set('key', key);
    url.searchParams.set('max_results', '50000');
    url.searchParams.set('include_games', 'true');
    url.searchParams.set('include_dlc', 'false');
    url.searchParams.set('include_software', 'false');
    url.searchParams.set('include_videos', 'false');
    url.searchParams.set('include_hardware', 'false');
    if (lastAppId > 0) url.searchParams.set('last_appid', String(lastAppId));

    const res = await axios.get(url.toString(), {
      timeout: 45000,
      validateStatus: () => true,
      headers: { Accept: 'application/json', 'User-Agent': 'OpenSteam/1.0' },
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Steam app list returned HTTP ${res.status}`);
    }

    const batch = Array.isArray(res.data?.response?.apps) ? res.data.response.apps : [];
    if (batch.length === 0) break;

    for (const item of batch) {
      if (typeof item.appid === 'number' && item.name?.trim()) {
        apps.push({ appid: item.appid, name: item.name.trim() });
      }
    }

    if (!res.data?.response?.have_more_results) break;
    const nextLast = res.data.response.last_appid;
    if (typeof nextLast !== 'number' || nextLast <= lastAppId) break;
    lastAppId = nextLast;
  }

  if (apps.length === 0) {
    throw new Error('Steam app list response was empty.');
  }

  steamAppListCache = { timestamp: Date.now(), apps };
  return apps;
}

async function searchSteamStoreByName(query) {
  const term = String(query || '').trim();
  if (!term) return [];

  const url = new URL('https://store.steampowered.com/api/storesearch/');
  url.searchParams.set('term', term);
  url.searchParams.set('l', 'english');
  url.searchParams.set('cc', 'US');

  const res = await axios.get(url.toString(), {
    timeout: 15000,
    validateStatus: () => true,
    headers: { Accept: 'application/json', 'User-Agent': 'OpenSteam/1.0' },
  });

  if (res.status < 200 || res.status >= 300) return [];
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  return items
    .filter((i) => typeof i.id === 'number' && i.name?.trim())
    .map((i) => ({ appid: i.id, name: i.name.trim() }));
}

function matchAppIdFromCatalogue(apps, requestName) {
  const targetName = normalizeSteamName(requestName);
  if (!targetName || targetName.length < 3) return null;

  let match = apps.find((app) => normalizeSteamName(app.name) === targetName);
  if (!match && targetName.length > 5) {
    match = apps.find((app) => {
      const currentName = normalizeSteamName(app.name);
      return currentName.length > 5 && (currentName.includes(targetName) || targetName.includes(currentName));
    });
  }

  if (!match?.appid) return null;
  return { appId: String(match.appid), name: String(match.name || requestName).slice(0, 200) };
}

/** Resolve a game title from the Steam catalogue when appdetails is rate-limited. */
async function lookupSteamAppNameById(appId, getConfigValue) {
  const id = Number(appId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const apps = await fetchSteamAppList(getConfigValue);
  const match = apps.find((app) => app.appid === id);
  return match?.name ? String(match.name).slice(0, 200) : null;
}

/** Resolve a pending game request's Steam App ID from its name when appId is missing. */
async function resolveAutogenAppIdFromName(requestName, getConfigValue) {
  let apps = [];
  try {
    apps = await fetchSteamAppList(getConfigValue);
  } catch (catalogueErr) {
    console.warn('[Autogen] Steam catalogue failed, trying store search:', catalogueErr.message);
    apps = await searchSteamStoreByName(requestName);
  }

  return matchAppIdFromCatalogue(apps, requestName);
}

module.exports = {
  fetchSteamAppList,
  searchSteamStoreByName,
  lookupSteamAppNameById,
  resolveAutogenAppIdFromName,
  normalizeSteamName,
};
