/**
 * Bulk-upload local manifest ZIPs to S3 (Tigris).
 *
 * Usage:  node scripts/bulk-s3-upload.js [--dry-run] [--concurrency N] [--start-from APPID]
 *
 * Reads all {appId}/{appId}.zip files from STORAGE_PATH/manifests (or storage/manifests)
 * and uploads them to the configured S3 bucket at key manifests/{appId}/{appId}.zip.
 * Also updates the Postgres Manifest table with storageType='s3' and s3Key.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');

// --- CLI args ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const concurrencyIdx = args.indexOf('--concurrency');
const CONCURRENCY = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) || 10 : 10;
const startFromIdx = args.indexOf('--start-from');
const START_FROM = startFromIdx !== -1 ? args[startFromIdx + 1] : null;
const SKIP_EXISTING = !args.includes('--no-skip');

// --- Config ---
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../storage');
const MANIFESTS_DIR = path.join(STORAGE_PATH, 'manifests');
const BUCKET = process.env.AWS_S3_BUCKET_NAME;

if (!BUCKET) {
  console.error('ERROR: AWS_S3_BUCKET_NAME is not set');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: !!process.env.AWS_ENDPOINT_URL,
});

const prisma = new PrismaClient();

// --- Helpers ---
async function s3ObjectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadOneManifest(appId, zipPath) {
  const s3Key = `manifests/${appId}/${appId}.zip`;
  const zipBuffer = fs.readFileSync(zipPath);
  const fileSize = zipBuffer.length;

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would upload ${appId} (${(fileSize / 1024).toFixed(1)} KB) → s3://${BUCKET}/${s3Key}`);
    return { ok: true, skipped: false, size: fileSize };
  }

  if (SKIP_EXISTING) {
    const exists = await s3ObjectExists(s3Key);
    if (exists) {
      return { ok: true, skipped: true, size: fileSize };
    }
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: zipBuffer,
    ContentType: 'application/zip',
  }));

  // Update DB record
  try {
    await prisma.manifest.updateMany({
      where: { steamAppId: String(appId) },
      data: {
        storageType: 's3',
        s3Key,
        fileSize: BigInt(fileSize),
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    // DB record might not exist yet — that's okay, the bot creates it on first gen
  }

  return { ok: true, skipped: false, size: fileSize };
}

// --- Main ---
async function main() {
  console.log(`\n=== Bulk S3 Upload ===`);
  console.log(`  Storage:     ${MANIFESTS_DIR}`);
  console.log(`  Bucket:      ${BUCKET}`);
  console.log(`  Endpoint:    ${process.env.AWS_ENDPOINT_URL || '(default AWS)'}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Dry run:     ${DRY_RUN}`);
  console.log(`  Skip existing: ${SKIP_EXISTING}`);
  if (START_FROM) console.log(`  Start from:  ${START_FROM}`);
  console.log();

  if (!fs.existsSync(MANIFESTS_DIR)) {
    console.error(`ERROR: Manifests directory not found: ${MANIFESTS_DIR}`);
    process.exit(1);
  }

  // Collect all appId directories that have a zip
  const dirs = fs.readdirSync(MANIFESTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

  let appIds = [];
  for (const dirName of dirs) {
    const zipPath = path.join(MANIFESTS_DIR, dirName, `${dirName}.zip`);
    if (fs.existsSync(zipPath)) {
      appIds.push({ appId: dirName, zipPath });
    }
  }

  if (START_FROM) {
    const idx = appIds.findIndex(a => a.appId === START_FROM);
    if (idx > 0) {
      console.log(`Skipping ${idx} apps before ${START_FROM}`);
      appIds = appIds.slice(idx);
    }
  }

  console.log(`Found ${appIds.length} ZIPs to upload\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  const startTime = Date.now();
  const errors = [];

  // Process in batches of CONCURRENCY
  for (let i = 0; i < appIds.length; i += CONCURRENCY) {
    const batch = appIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ appId, zipPath }) => {
        try {
          const result = await uploadOneManifest(appId, zipPath);
          return { appId, ...result };
        } catch (e) {
          return { appId, ok: false, error: e.message };
        }
      })
    );

    for (const r of results) {
      const val = r.status === 'fulfilled' ? r.value : { appId: '?', ok: false, error: r.reason?.message };
      if (val.ok && !val.skipped) {
        uploaded++;
        totalBytes += val.size || 0;
      } else if (val.ok && val.skipped) {
        skipped++;
      } else {
        failed++;
        errors.push(`${val.appId}: ${val.error}`);
        console.error(`  ❌ ${val.appId}: ${val.error}`);
      }
    }

    const total = uploaded + skipped + failed;
    const pct = ((total / appIds.length) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const mbUploaded = (totalBytes / (1024 * 1024)).toFixed(1);
    process.stdout.write(`\r  Progress: ${total}/${appIds.length} (${pct}%) | Uploaded: ${uploaded} | Skipped: ${skipped} | Failed: ${failed} | ${mbUploaded} MB | ${elapsed}s`);
  }

  console.log('\n');
  console.log(`=== Done ===`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Total MB: ${(totalBytes / (1024 * 1024)).toFixed(1)}`);
  console.log(`  Time:     ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  if (errors.length > 0) {
    console.log(`\n  First 20 errors:`);
    errors.slice(0, 20).forEach(e => console.log(`    ${e}`));
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
