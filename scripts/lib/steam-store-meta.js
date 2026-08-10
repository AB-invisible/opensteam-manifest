/**
 * Resolve Steam Store metadata for Discord announcements and manifest naming.
 */
const axios = require('axios');
const { lookupSteamAppNameById } = require('./steam-app-list');

const STEAM_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'OpenSteam/1.0 (Discord Bot)',
};

function isPlaceholderManifestName(name) {
  return !name || /^(Manifest|App)\s+\d+$/i.test(String(name).trim());
}

async function readSystemConfig(prisma, key) {
  if (!prisma) return null;
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function resolveConfigValue(prisma, key) {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  return readSystemConfig(prisma, key);
}

async function resolveSteamStoreMeta(appId, prisma) {
  const appIdStr = String(appId || '').trim();
  if (!/^\d+$/.test(appIdStr)) return null;

  const url = `https://store.steampowered.com/api/appdetails?appids=${appIdStr}&filters=basic&l=english&cc=us`;
  const delays = [0, 800, 2200, 5000, 8000];

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    try {
      const res = await axios.get(url, {
        timeout: 12_000,
        validateStatus: () => true,
        headers: STEAM_HEADERS,
      });
      if (res.status === 429) {
        console.warn(`[SteamMeta] 429 for ${appIdStr}, attempt ${attempt + 1}`);
        continue;
      }
      if (res.status < 200 || res.status >= 300) break;

      const node = res.data?.[appIdStr];
      if (!node) continue;
      if (node.success === false) break;

      const data = node.data;
      if (!data) break;

      return {
        gameName: data.name ? String(data.name).slice(0, 200) : null,
        imageUrl: data.header_image || null,
        shortDescription: data.short_description ? String(data.short_description).slice(0, 500) : null,
      };
    } catch (e) {
      console.warn(`[SteamMeta] attempt ${attempt + 1} failed for ${appIdStr}:`, e?.message || e);
    }
  }

  let gameName = null;
  try {
    gameName = await lookupSteamAppNameById(appIdStr, (key) => resolveConfigValue(prisma, key));
  } catch (e) {
    console.warn(`[SteamMeta] app list lookup failed for ${appIdStr}:`, e?.message || e);
  }

  if (gameName) {
    return { gameName, imageUrl: null, shortDescription: null };
  }

  return null;
}

async function readManifestMetaFromDb(prisma, appIdStr) {
  if (!prisma) return null;
  try {
    return await prisma.manifest.findUnique({
      where: { steamAppId: appIdStr },
      select: { name: true, imageUrl: true, description: true },
    });
  } catch {
    return null;
  }
}

/** Fill in real Steam title/image when callers only know the App ID placeholder. */
async function enrichAnnouncementPayload({ appId, gameName, imageUrl, shortDescription } = {}, prisma) {
  const appIdStr = String(appId || '').trim();
  const needsName = isPlaceholderManifestName(gameName);
  const needsDesc = !String(shortDescription || '').trim();
  const needsImage = !String(imageUrl || '').trim();

  if (!needsName && !needsDesc && !needsImage) {
    return { appId: appIdStr, gameName, imageUrl, shortDescription };
  }

  const steam = await resolveSteamStoreMeta(appIdStr, prisma);
  const fromDb = needsName || needsImage || needsDesc ? await readManifestMetaFromDb(prisma, appIdStr) : null;

  let resolvedName = gameName;
  if (needsName) {
    resolvedName =
      steam?.gameName ||
      (fromDb?.name && !isPlaceholderManifestName(fromDb.name) ? fromDb.name : null) ||
      gameName ||
      `App ${appIdStr}`;
  }

  let resolvedImage = imageUrl || steam?.imageUrl || fromDb?.imageUrl || null;
  let resolvedDesc = shortDescription || steam?.shortDescription || fromDb?.description || null;

  return {
    appId: appIdStr,
    gameName: resolvedName,
    imageUrl: resolvedImage,
    shortDescription: resolvedDesc,
  };
}

module.exports = {
  isPlaceholderManifestName,
  resolveSteamStoreMeta,
  enrichAnnouncementPayload,
};
