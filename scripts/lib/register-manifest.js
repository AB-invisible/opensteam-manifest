/**
 * Persist manifest zips locally/S3 and upsert Postgres — no Next.js web app required.
 */
const fs = require('fs');
const path = require('path');
const { resolveSyncUserId } = require('./sync-storage-manifests');
const { isPlaceholderManifestName, resolveSteamStoreMeta } = require('./steam-store-meta');

function getStoragePath() {
  return process.env.STORAGE_PATH || path.join(__dirname, '../../data');
}

function persistManifestZip(appId, zipBuffer, s3Client) {
  const appIdStr = String(appId);
  const filename = `${appIdStr}.zip`;
  const s3Key = `manifests/${appIdStr}/${filename}`;

  if (s3Client && process.env.AWS_S3_BUCKET_NAME) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    return s3Client
      .send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: s3Key,
          Body: zipBuffer,
          ContentType: 'application/zip',
        }),
      )
      .then(() => ({ storageType: 's3', s3Key }))
      .catch((e) => {
        console.warn('[RegisterManifest] S3 persist failed, falling back to local:', e.message);
        return persistManifestZipLocal(appIdStr, filename, zipBuffer);
      });
  }

  return Promise.resolve(persistManifestZipLocal(appIdStr, filename, zipBuffer));
}

function persistManifestZipLocal(appIdStr, filename, zipBuffer) {
  const storagePath = getStoragePath();
  const dir = path.join(storagePath, 'manifests', appIdStr);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), zipBuffer);
  return { storageType: 'local', s3Key: null };
}

/**
 * @returns {Promise<{ ok: true, isNew: boolean } | { ok: false, error: string, isNew: false }>}
 */
async function registerManifestLocally(prisma, { appId, gameName, zipBuffer, userId, s3Client }) {
  const appIdStr = String(appId).trim();
  if (!/^\d+$/.test(appIdStr)) {
    return { ok: false, isNew: false, error: `Invalid appId "${appIdStr}"` };
  }
  if (!zipBuffer || !zipBuffer.length) {
    return { ok: false, isNew: false, error: 'Empty zip buffer' };
  }

  const existing = await prisma.manifest.findUnique({
    where: { steamAppId: appIdStr },
    select: { id: true },
  });
  const isNew = !existing;

  const ownerId = userId || (await resolveSyncUserId(prisma));
  let name = String(gameName || `App ${appIdStr}`).slice(0, 200);
  let imageUrl = null;
  let description = null;
  const steam = await resolveSteamStoreMeta(appIdStr, prisma);
  if (isPlaceholderManifestName(name) && steam?.gameName) name = steam.gameName;
  if (steam?.imageUrl) imageUrl = steam.imageUrl;
  if (steam?.shortDescription) description = steam.shortDescription;

  try {
    const { storageType, s3Key } = await persistManifestZip(appIdStr, zipBuffer, s3Client);
    await prisma.manifest.upsert({
      where: { steamAppId: appIdStr },
      update: {
        name,
        fileSize: BigInt(zipBuffer.length),
        storageType,
        ...(imageUrl ? { imageUrl } : {}),
        ...(description ? { description } : {}),
        ...(s3Key ? { s3Key } : {}),
        updatedAt: new Date(),
      },
      create: {
        steamAppId: appIdStr,
        name,
        fileSize: BigInt(zipBuffer.length),
        userId: ownerId,
        storageType,
        s3Key: s3Key || undefined,
        imageUrl: imageUrl || undefined,
        description: description || undefined,
        tags: [],
      },
    });
    return { ok: true, isNew };
  } catch (e) {
    return { ok: false, isNew: false, error: e.message || String(e) };
  }
}

module.exports = {
  registerManifestLocally,
  getStoragePath,
};
