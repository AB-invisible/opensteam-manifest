/**
 * Shared Discord bot credential + failover helpers for bot-daemon.js (CommonJS).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const QUARANTINE_CODES = new Set([20026]);

let dbConfigWarned = false;

async function getConfigValue(key) {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    const fromDb = row?.value?.trim();
    if (fromDb) return fromDb;
  } catch (e) {
    if (!dbConfigWarned) {
      dbConfigWarned = true;
      console.warn(
        `[Bot Config] Database unavailable for system_configs — using env for ${key} and other keys:`,
        e?.message || e,
      );
    }
  }
  const fromEnv = process.env[key]?.trim();
  return fromEnv || null;
}

async function getFailoverMode() {
  const raw = (await getConfigValue('DISCORD_BOT_FAILOVER_MODE')) || 'auto';
  if (raw === 'primary' || raw === 'backup' || raw === 'auto') return raw;
  return 'auto';
}

async function isBotQuarantined() {
  return (await getConfigValue('DISCORD_BOT_QUARANTINED')) === 'true';
}

async function shouldUseBackupBot() {
  const mode = await getFailoverMode();
  if (mode === 'backup') return true;
  if (mode === 'primary') return false;
  return isBotQuarantined();
}

async function resolvePrimaryBotToken() {
  return getConfigValue('DISCORD_BOT_TOKEN');
}

async function resolveBackupBotToken() {
  return getConfigValue('DISCORD_BACKUP_BOT_TOKEN');
}

/** Gateway + guild slash commands always prefer the primary bot when configured. */
async function resolveGuildBotToken() {
  const primary = await resolvePrimaryBotToken();
  if (primary) return { token: primary, source: 'primary' };
  const backup = await resolveBackupBotToken();
  if (backup) return { token: backup, source: 'backup' };
  return { token: null, source: 'primary' };
}

/** DM / outbound failover — backup when failover mode is active. */
async function resolveActiveBotToken() {
  const useBackup = await shouldUseBackupBot();
  if (useBackup) {
    const backup = await resolveBackupBotToken();
    return { token: backup, source: 'backup' };
  }
  const primary = await resolvePrimaryBotToken();
  return { token: primary, source: 'primary' };
}

async function resolveAllBotTokens() {
  const [primary, backup] = await Promise.all([
    resolvePrimaryBotToken(),
    resolveBackupBotToken(),
  ]);
  const out = [];
  if (primary) out.push(primary);
  if (backup && backup !== primary) out.push(backup);
  return out;
}

function parseDiscordApiErrorBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isDiscordQuarantineResponse(status, bodyText) {
  if (status !== 403) return false;
  const { code } = parseDiscordApiErrorBody(bodyText);
  return code !== undefined && QUARANTINE_CODES.has(code);
}

async function upsertConfig(key, value, isSecret = false) {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value, isSecret },
  });
}

async function markBotQuarantined() {
  await upsertConfig('DISCORD_BOT_QUARANTINED', 'true');
}

module.exports = {
  getConfigValue,
  getFailoverMode,
  isBotQuarantined,
  shouldUseBackupBot,
  resolvePrimaryBotToken,
  resolveBackupBotToken,
  resolveGuildBotToken,
  resolveActiveBotToken,
  resolveAllBotTokens,
  isDiscordQuarantineResponse,
  markBotQuarantined,
};
