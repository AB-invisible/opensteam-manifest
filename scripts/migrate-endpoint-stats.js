const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalizeEndpoint(pathname) {
  let clean = pathname;
  // 1. Normalize legacy API keys in path (e.g. /api/gg_... or /api/mg_...)
  clean = clean.replace(/^\/api\/(gg_[0-9a-fA-F]+|mg_[0-9a-fA-F]+)/, '/api/[apiKey]');
  // 2. Normalize Steam App IDs (trailing numeric values)
  clean = clean.replace(/\/generate\/\d+$/, '/generate/[appId]');
  clean = clean.replace(/\/download\/\d+$/, '/download/[appId]');
  clean = clean.replace(/\/request\/\d+$/, '/request/[appId]');
  // 3. Normalize OnlineFix download names
  clean = clean.replace(/\/onlinefix\/download\/.+$/, '/onlinefix/download/[name]');
  return clean;
}

async function main() {
  console.log('Fetching all usage logs...');
  const logs = await prisma.apiUsage.findMany({
    select: {
      id: true,
      endpoint: true
    }
  });

  console.log(`Found ${logs.length} logs in total. Checking for normalization...`);

  const updates = [];
  for (const log of logs) {
    const normalized = normalizeEndpoint(log.endpoint);
    if (normalized !== log.endpoint) {
      updates.push({ id: log.id, endpoint: normalized });
    }
  }

  console.log(`${updates.length} logs need to be normalized.`);

  if (updates.length === 0) {
    console.log('No updates needed.');
    return;
  }

  console.log('Starting migration in batches of 500...');
  const batchSize = 500;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map(u => 
        prisma.apiUsage.update({
          where: { id: u.id },
          data: { endpoint: u.endpoint }
        })
      )
    );
    console.log(`Updated ${Math.min(i + batchSize, updates.length)} / ${updates.length}...`);
  }

  console.log('Migration completed successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
