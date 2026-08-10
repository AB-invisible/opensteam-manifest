require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');
const { resolveSteamImagesForCatalog } = require('./lib/onlinefix-site');

async function main() {
  const prisma = new PrismaClient();
  try {
    const before = await prisma.onlineFixGame.count({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
    });
    console.log('[resolve-missing] Before:', before);

    const result = await resolveSteamImagesForCatalog({ prismaClient: prisma, limit: 50 });
    console.log('[resolve-missing] Steam resolved:', result);

    const missing = await prisma.onlineFixGame.findMany({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
      select: { id: true, name: true, fileName: true },
    });
    console.log('[resolve-missing] Still missing:', missing.length);
    if (missing.length) console.log(JSON.stringify(missing, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
