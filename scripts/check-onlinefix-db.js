require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');

async function main() {
  if (process.env.NEON_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
  }
  const prisma = new PrismaClient();
  try {
    const sample = await prisma.onlineFixGame.findFirst({
      where: { name: '20XX' },
      select: { name: true, fileName: true, imageUrl: true, sourceUrl: true, steamAppId: true },
    });
    const withImage = await prisma.onlineFixGame.count({ where: { NOT: { imageUrl: null } } });
    const total = await prisma.onlineFixGame.count();
    console.log('sample:', sample);
    console.log('with image:', withImage, '/', total);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
