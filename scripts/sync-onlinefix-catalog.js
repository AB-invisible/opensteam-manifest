#!/usr/bin/env node
/**
 * Rebuild OnlineFix catalog: PeronDepot downloads + online-fix.me posters + Steam headers.
 */
require('dotenv').config({ quiet: true });

const { PrismaClient } = require('@prisma/client');

async function main() {
  if (process.env.NEON_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
  }

  const prisma = new PrismaClient();
  try {
    const { refreshOnlineFixCatalog, syncOnlineFixIndexFromPeronDepot } = require('./lib/onlinefix-s3');
    const {
      syncOnlineFixIndexFromOfficialSite,
      resolveSteamImagesForCatalog,
      normalizeOnlineFixCatalogNames,
    } = require('./lib/onlinefix-site');

    const quick = process.argv.includes('--quick');

    if (quick) {
      console.log('[sync-onlinefix] Quick refresh (names + official posters + Steam headers)...');
      await syncOnlineFixIndexFromPeronDepot({ prismaClient: prisma });
      const normalized = await normalizeOnlineFixCatalogNames({ prismaClient: prisma });
      const official = await syncOnlineFixIndexFromOfficialSite({ prismaClient: prisma });
      const steam = await resolveSteamImagesForCatalog({ prismaClient: prisma, limit: 200 });
      console.log('[sync-onlinefix] Normalized:', normalized);
      console.log('[sync-onlinefix] Official:', official);
      console.log('[sync-onlinefix] Steam images:', steam);
    } else {
      console.log('[sync-onlinefix] Full refresh (official site + images)...');
      const result = await refreshOnlineFixCatalog({ prismaClient: prisma, force: true });
      console.log('[sync-onlinefix] Result:', result);
    }
    const count = await prisma.onlineFixGame.count();
    const sample = await prisma.onlineFixGame.findMany({
      take: 5,
      orderBy: { name: 'asc' },
      select: { name: true, fileName: true, imageUrl: true, sourceUrl: true },
    });
    console.log('[sync-onlinefix] Total rows:', count);
    console.log('[sync-onlinefix] Sample:', JSON.stringify(sample, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
