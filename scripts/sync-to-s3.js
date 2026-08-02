const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
require('dotenv').config();

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../data');
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

if (!BUCKET_NAME) {
  console.error('Error: AWS_S3_BUCKET_NAME is not defined in environment.');
  process.exit(1);
}

const s3Client = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || 'auto',
  endpoint: process.env.AWS_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true,
});

async function syncAll() {
  const manifestsDir = path.join(STORAGE_PATH, 'manifests');
  
  if (!fs.existsSync(manifestsDir)) {
    console.log('No manifests directory found at', manifestsDir);
    return;
  }

  const appIds = fs.readdirSync(manifestsDir).filter(entry => {
    return fs.statSync(path.join(manifestsDir, entry)).isDirectory();
  });

  console.log(`Found ${appIds.length} manifest directories. Starting sync...`);

  for (const appId of appIds) {
    const dirPath = path.join(manifestsDir, appId);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.zip'));

    for (const filename of files) {
      const filePath = path.join(dirPath, filename);
      const s3Key = `manifests/${appId}/${filename}`;

      try {
        console.log(`[${appId}] Uploading ${filename} to S3...`);
        
        const fileStream = fs.createReadStream(filePath);
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fileStream,
            ContentType: 'application/zip',
          },
        });

        await upload.done();
        console.log(`[${appId}] Successfully uploaded. Deleting local file...`);
        fs.unlinkSync(filePath);
        
        // Optional: remove empty appId directory
        if (fs.readdirSync(dirPath).length === 0) {
            fs.rmdirSync(dirPath);
        }
      } catch (err) {
        console.error(`[${appId}] Failed to sync ${filename}:`, err.message);
      }
    }
  }

  console.log('Sync complete!');
}

syncAll().catch(console.error);
