#!/usr/bin/env node
require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const { parseOnlineFixDisplayName } = require('./lib/onlinefix-s3');
    const rows = await prisma.onlineFixGame.findMany({ select: { id: true, name: true, fileName: true } });
    let updated = 0;
    for (const row of rows) {
      const clean = parseOnlineFixDisplayName(row.name, row.fileName);
      if (!clean || clean === row.name) continue;
      await prisma.onlineFixGame.update({ where: { id: row.id }, data: { name: clean } });
      updated += 1;
    }
    const sample = await prisma.onlineFixGame.findMany({
      take: 5,
      orderBy: { name: 'asc' },
      select: { name: true, imageUrl: true },
    });
    console.log('updated', updated, 'sample', sample);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
