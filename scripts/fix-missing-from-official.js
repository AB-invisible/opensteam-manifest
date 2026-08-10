require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');
const { scrapeOfficialSiteCatalog, normalizeOnlineFixKey } = require('./lib/onlinefix-site');
const { parseOnlineFixDisplayName } = require('./lib/onlinefix-s3');

async function main() {
  const prisma = new PrismaClient();
  try {
    const missing = await prisma.onlineFixGame.findMany({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
      select: { id: true, name: true, fileName: true, sourceUrl: true },
    });
    console.log('[fix-missing] count', missing.length, missing.map((m) => m.name));

    const official = await scrapeOfficialSiteCatalog({ maxPages: 70 });
    const byKey = new Map();
    for (const g of official) {
      if (g.key) byKey.set(g.key, g);
    }
    console.log('[fix-missing] official index', official.length);

    let fixed = 0;
    for (const row of missing) {
      const title = parseOnlineFixDisplayName(row.name, row.fileName);
      const key = normalizeOnlineFixKey(title);
      const hit = byKey.get(key);
      if (!hit?.imageUrl) {
        console.log('[skip]', title);
        continue;
      }
      await prisma.onlineFixGame.update({
        where: { id: row.id },
        data: {
          imageUrl: hit.imageUrl,
          sourceUrl: hit.pageUrl || row.sourceUrl,
        },
      });
      console.log('[ok]', title);
      fixed += 1;
    }

    const left = await prisma.onlineFixGame.count({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
    });
    console.log('[done] fixed', fixed, 'remaining', left);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
