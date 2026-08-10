/**
 * Resolve Steam Store metadata for Discord announcements and manifest naming.
 */
const axios = require('axios');

function isPlaceholderManifestName(name) {
  return !name || /^(Manifest|App)\s+\d+$/i.test(String(name).trim());
}

async function resolveSteamStoreMeta(appId) {
  const appIdStr = String(appId || '').trim();
  if (!/^\d+$/.test(appIdStr)) return null;

  const url = `https://store.steampowered.com/api/appdetails?appids=${appIdStr}&filters=basic&l=english&cc=us`;
  const delays = [0, 800, 2200];

  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await axios.get(url, { timeout: 8000, validateStatus: () => true });
      if (res.status === 429) continue;
      if (res.status < 200 || res.status >= 300) break;

      const data = res.data?.[appIdStr]?.data;
      if (!data) break;

      return {
        gameName: data.name ? String(data.name).slice(0, 200) : null,
        imageUrl: data.header_image || null,
        shortDescription: data.short_description ? String(data.short_description).slice(0, 500) : null,
      };
    } catch {
      /* retry */
    }
  }

  return null;
}

/** Fill in real Steam title when callers only know the App ID placeholder. */
async function enrichAnnouncementPayload({ appId, gameName, imageUrl, shortDescription } = {}) {
  const appIdStr = String(appId || '').trim();
  const needsName = isPlaceholderManifestName(gameName);
  const needsDesc = !String(shortDescription || '').trim();
  const needsImage = !String(imageUrl || '').trim();

  if (!needsName && !needsDesc && !needsImage) {
    return { appId: appIdStr, gameName, imageUrl, shortDescription };
  }

  const steam = await resolveSteamStoreMeta(appIdStr);
  return {
    appId: appIdStr,
    gameName: (needsName ? steam?.gameName : null) || gameName || steam?.gameName || `App ${appIdStr}`,
    imageUrl: imageUrl || steam?.imageUrl || null,
    shortDescription: shortDescription || steam?.shortDescription || null,
  };
}

module.exports = {
  isPlaceholderManifestName,
  resolveSteamStoreMeta,
  enrichAnnouncementPayload,
};
