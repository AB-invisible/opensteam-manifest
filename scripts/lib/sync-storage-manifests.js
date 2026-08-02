/**
 * Register manifest zips under STORAGE_PATH/manifests into the Postgres catalog.
 * Files on disk alone are not visible to /gen, the website, or autogen until synced.
 */
const fs = require('fs');
const path = require('path');

function getStoragePath() {
  return process.env.STORAGE_PATH || path.join(__dirname, '../../data');
}

function getManifestsRoot() {
  return path.join(getStoragePath(), 'manifests');
}

async function resolveSyncUserId(prisma) {
  const operatorDiscordId = process.env.UPLOAD_OPERATOR_DISCORD_ID?.trim();
  if (operatorDiscordId) {
    const user = await prisma.user.findUnique({ where: { discordId: operatorDiscordId } });
    if (user) return user.id;
  }

  const owner =
    (await prisma.user.findFirst({
      where: { role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
    })) ||
    (await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    }));

  if (!owner) {
    throw new Error('No OWNER/ADMIN user in database — create one before syncing manifests.');
  }
  return owner.id;
}

/** Scan STORAGE_PATH/manifests/{appId}/{appId}.zip */
function listLocalManifestZips(manifestsRoot = getManifestsRoot()) {
  let entries;
  try {
    entries = fs.readdirSync(manifestsRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const appId = entry.name.trim();
    if (!/^\d+$/.test(appId)) continue;

    const zipPath = path.join(manifestsRoot, appId, `${appId}.zip`);
    if (!fs.existsSync(zipPath)) continue;

    const stat = fs.statSync(zipPath);
    if (!stat.isFile() || stat.size <= 0) continue;

    rows.push({ appId, fileSize: stat.size });
  }
  return rows;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {number} [options.limit] cap inserts this run (0 = all missing)
 * @param {number} [options.batchSize]
 * @param {(stats: object) => void} [options.onProgress]
 * @param {(appId: string) => string|undefined} [options.nameLookup]
 */
async function syncStorageManifestsToDb(prisma, options = {}) {
  const {
    dryRun = false,
    limit = 0,
    batchSize = 500,
    onProgress,
    nameLookup,
  } = options;

  const manifestsRoot = getManifestsRoot();
  if (!fs.existsSync(manifestsRoot)) {
    return { scanned: 0, alreadyInDb: 0, added: 0, manifestsRoot };
  }

  const userId = await resolveSyncUserId(prisma);
  const local = listLocalManifestZips(manifestsRoot);
  const existing = await prisma.manifest.findMany({ select: { steamAppId: true } });
  const present = new Set(existing.map((row) => String(row.steamAppId)));

  let missing = local.filter((row) => !present.has(row.appId));
  if (limit > 0) missing = missing.slice(0, limit);

  let added = 0;
  for (let i = 0; i < missing.length; i += batchSize) {
    const chunk = missing.slice(i, i + batchSize);
    const data = chunk.map(({ appId, fileSize }) => ({
      steamAppId: appId,
      name: String(nameLookup?.(appId) || `App ${appId}`).slice(0, 200),
      fileSize: BigInt(fileSize),
      userId,
      storageType: 'local',
      tags: [],
    }));

    if (!dryRun) {
      await prisma.manifest.createMany({ data, skipDuplicates: true });
    }

    added += chunk.length;
    onProgress?.({
      added,
      pending: missing.length,
      scanned: local.length,
      alreadyInDb: present.size,
    });
  }

  return {
    scanned: local.length,
    alreadyInDb: present.size,
    added,
    pending: missing.length,
    manifestsRoot,
  };
}

module.exports = {
  getStoragePath,
  getManifestsRoot,
  listLocalManifestZips,
  resolveSyncUserId,
  syncStorageManifestsToDb,
};
