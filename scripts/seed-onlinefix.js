const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

const {
  getOnlineFixBucketName,
  syncOnlineFixIndexFromS3,
} = require('./lib/onlinefix-s3');

const prisma = new PrismaClient();

async function run() {
  const bucketName = await getOnlineFixBucketName();
  if (!bucketName) {
    console.warn('WARN: AWS_S3_BUCKET_NAME is not set. Skipping S3 sync.');
    process.exit(0);
  }

  console.log(`[1/3] Indexing OnlineFix archives from s3://${bucketName}...`);
  const result = await syncOnlineFixIndexFromS3({ prismaClient: prisma });
  console.log(`      Found ${result.found}, added ${result.added}, updated ${result.updated}.`);

  console.log(`[2/3] Scraping api.perondepot.xyz for new files...`);
  const axios = require('axios');
  let html = '';
  try {
    const response = await axios.get('https://api.perondepot.xyz/', { timeout: 15000 });
    html = response.data;
  } catch (err) {
    console.error('❌ Failed to fetch PeronDepot:', err.message);
    process.exit(1);
  }

  const lines = html.split('\n');
  const scrapedGames = [];
  
  for (let line of lines) {
    if (!line.trim() || !line.includes('<a href="')) continue;
    const hrefStart = line.indexOf('<a href="') + 9;
    const hrefEnd = line.indexOf('"', hrefStart);
    if (hrefStart === -1 || hrefEnd === -1) continue;
    
    const href = line.substring(hrefStart, hrefEnd);
    const textStart = line.indexOf('>', hrefEnd) + 1;
    const textEnd = line.indexOf('<', textStart);
    if (textStart === -1 || textEnd === -1) continue;
    
    const name = line.substring(textStart, textEnd).trim();
    if (!name || name.includes('..') || name.includes('docker') || name.includes('nginx')) continue;
    if (!name.endsWith('.rar') && !name.endsWith('.zip')) continue;
    
    const cleanName = name.replace('.rar', '').replace('.zip', '').replace(/_/g, ' ').trim();
    const sizeMatch = line.substring(textEnd).match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|K|M|G|T)/i);
    
    scrapedGames.push({
      name: cleanName,
      fileName: name,
      fileUrl: `https://api.perondepot.xyz/${href}`,
      fileSize: sizeMatch ? sizeMatch[0] : 'Unknown'
    });
  }
  console.log(`      Found ${scrapedGames.length} archive(s) on PeronDepot.`);

  console.log(`[3/3] Checking for missing files and mirroring to S3...`);
  const { mirrorOnlineFixToS3 } = require('./lib/onlinefix-s3');
  
  let downloadCount = 0;
  for (let i = 0; i < scrapedGames.length; i++) {
    const game = scrapedGames[i];
    const existing = await prisma.onlineFixGame.findFirst({
      where: { fileName: game.fileName }
    });

    if (!existing || (existing.fileUrl && existing.fileUrl.includes('api.perondepot.xyz'))) {
      if (!existing) {
        console.log(`      [${i+1}/${scrapedGames.length}] New file detected: ${game.fileName}. Creating DB record...`);
      } else {
        console.log(`      [${i+1}/${scrapedGames.length}] File ${game.fileName} is in DB but hasn't been mirrored to S3 yet.`);
      }

      let gameRecord = existing;
      if (!gameRecord) {
        gameRecord = await prisma.onlineFixGame.create({ data: game });
      }

      console.log(`      -> Mirroring ${gameRecord.fileName} to S3...`);
      try {
        await mirrorOnlineFixToS3(gameRecord, { prismaClient: prisma });
        downloadCount++;
      } catch (err) {
        console.error(`      -> ❌ Failed to mirror ${gameRecord.fileName}:`, err.message);
      }
    }
  }

  console.log(`\n✅ Done! Mirrored ${downloadCount} new file(s) to S3.`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
