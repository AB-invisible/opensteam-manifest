require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');
const { streamOnlineFixArchive, getOnlineFixDownloadUrl } = require('./lib/onlinefix-s3');

async function main() {
  const prisma = new PrismaClient();
  try {
    const game = await prisma.onlineFixGame.findFirst({ where: { fileSize: '20M' } });
    console.log('game', game?.name, game?.fileUrl?.slice(0, 60));
    const streamed = await streamOnlineFixArchive(game);
    console.log('stream', streamed.source, streamed.contentLength);
    const url = await getOnlineFixDownloadUrl(game);
    console.log('redirect', url?.slice(0, 80));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
