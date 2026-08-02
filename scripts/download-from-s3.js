const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');
const { Readable } = require('stream');
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const prisma = new PrismaClient();
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../data');
/// Config (override via .env on production) ///
const ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || '';
const REGION = process.env.AWS_DEFAULT_REGION || 'auto';
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || '';

if (!BUCKET_NAME || !ACCESS_KEY || !SECRET_KEY || !ENDPOINT_URL) {
  console.error('Error: set AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME in .env');
  process.exit(1);
}

const s3Client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT_URL,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
  forcePathStyle: true,
});

async function downloadS3Object(key) {
  const localPath = path.join(STORAGE_PATH, key);
  const localDir = path.dirname(localPath);

  if (fs.existsSync(localPath)) {
    return 'skipped';
  }

  fs.mkdirSync(localDir, { recursive: true });

  try {
    const getCmd = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const getRes = await s3Client.send(getCmd);
    const writeStream = fs.createWriteStream(localPath);

    await new Promise((resolve, reject) => {
      if (getRes.Body instanceof Readable) {
        getRes.Body.pipe(writeStream);
        getRes.Body.on('error', reject);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      } else {
        Readable.from(getRes.Body).pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      }
    });

    return 'downloaded';
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return 'not_found';
    }
    console.error(`[S3 Error] Failed to download ${key}:`, err.message);
    return 'error';
  }
}

async function downloadAllFromDBAndS3() {
  console.log(`[S3 Download] Connecting to bucket "${BUCKET_NAME}"...`);
  console.log(`[S3 Download] Target local storage path: ${STORAGE_PATH}\n`);

  // 1. Fetch all registered App IDs from Database
  console.log('--- Phase 1: Fetching manifests registered in Database ---');
  let dbManifests = [];
  try {
    dbManifests = await prisma.manifest.findMany({ select: { steamAppId: true } });
    console.log(`Found ${dbManifests.length} manifest record(s) in PostgreSQL.\n`);
  } catch (err) {
    console.warn('Could not query database (continuing with S3 listing):', err.message);
  }

  let dbDownloaded = 0;
  let dbSkipped = 0;
  let dbMissing = 0;

  for (const m of dbManifests) {
    const appId = String(m.steamAppId);
    const key = `manifests/${appId}/${appId}.zip`;

    const status = await downloadS3Object(key);
    if (status === 'downloaded') {
      console.log(`[DB -> S3 Downloaded] ${key}`);
      dbDownloaded++;
    } else if (status === 'skipped') {
      dbSkipped++;
    } else if (status === 'not_found') {
      dbMissing++;
    }
  }

  console.log(`Phase 1 Complete: Downloaded ${dbDownloaded}, Skipped ${dbSkipped} (Already local), Missing in S3: ${dbMissing}.\n`);

  // 2. Scan entire S3 bucket to pick up any extra files not explicitly in DB
  console.log('--- Phase 2: Scanning S3 bucket for all remaining objects ---');
  let continuationToken = undefined;
  let s3Downloaded = 0;
  let s3Skipped = 0;

  do {
    const listCmd = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'manifests/',
      ContinuationToken: continuationToken,
    });

    const response = await s3Client.send(listCmd);
    const contents = response.Contents || [];

    for (const item of contents) {
      if (!item.Key || item.Key.endsWith('/')) continue;

      const status = await downloadS3Object(item.Key);
      if (status === 'downloaded') {
        console.log(`[S3 Bucket Downloaded] ${item.Key} (${(item.Size / 1024 / 1024).toFixed(2)} MB)`);
        s3Downloaded++;
      } else if (status === 'skipped') {
        s3Skipped++;
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`Phase 2 Complete: Downloaded ${s3Downloaded} extra file(s), Skipped ${s3Skipped} existing file(s).\n`);
  console.log('=== All Manifest S3 Downloads Finished Successfully ===');
}

downloadAllFromDBAndS3()
  .catch(err => {
    console.error('[Fatal S3 Download Error]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
