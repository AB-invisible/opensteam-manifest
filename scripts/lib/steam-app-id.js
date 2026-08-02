/**
 * Validates Discord /gen appid input: numeric Steam App ID only (no URLs or text).
 */
function normalizeNumericSteamAppId(raw) {
  if (raw == null || raw === '') {
    return { ok: false, message: 'App ID is required.' };
  }

  const value = String(raw).trim();
  if (!value) {
    return { ok: false, message: 'App ID is required.' };
  }

  if (
    /https?:\/\//i.test(value) ||
    /steampowered|steamcommunity|discord\.gg/i.test(value) ||
    /[:/\\]/.test(value)
  ) {
    return {
      ok: false,
      message: 'Links are not allowed. Use a numeric Steam App ID only (e.g. `730`).',
    };
  }

  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      message: 'App ID must be numeric only (e.g. `730`). Links and text are not allowed.',
    };
  }

  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return { ok: false, message: 'Invalid Steam App ID.' };
  }

  return { ok: true, appId: value };
}

/** Read appid from a slash interaction (INTEGER or legacy STRING option). */
function getGenAppIdFromInteraction(interaction) {
  const intVal = interaction.options.getInteger('appid');
  if (intVal != null) return normalizeNumericSteamAppId(intVal);
  return normalizeNumericSteamAppId(interaction.options.getString('appid'));
}

module.exports = { normalizeNumericSteamAppId, getGenAppIdFromInteraction };
