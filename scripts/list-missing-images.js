require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.onlineFixGame.findMany({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
      select: { name: true, fileName: true, sourceUrl: true, imageUrl: true },
    });
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main();
