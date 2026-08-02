const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });
const { syncOnlineFixIndexFromS3, BUCKET_NAME, ONLINEFIX_PREFIX } = require('./lib/onlinefix-s3');

const prisma = new PrismaClient();

async function main() {
  if (!BUCKET_NAME) {
    console.error('ERROR: AWS_S3_BUCKET_NAME is not set.');
    process.exit(1);
  }

  console.log(`--- Starting OnlineFix S3 Index Sync (${ONLINEFIX_PREFIX}) ---`);
  const result = await syncOnlineFixIndexFromS3({ prismaClient: prisma });

  console.log(`Indexed ${result.found} OnlineFix object(s). Added ${result.added}, updated ${result.updated}.`);
  console.log('\n--- Sync Complete ---');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
