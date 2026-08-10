require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}

const { PrismaClient } = require('@prisma/client');
const { searchSteamStoreByName } = require('./lib/steam-app-list');
const { steamHeaderImageUrl, parseOnlineFixDisplayName } = require('./lib/onlinefix-s3');

const MANUAL = {
  "Don't Panic! It is Just a Turbulence": null,
  'PAC-MAN Mega Tunnel Battle Chomp Champs': null,
  'Timeflow Time & Money Sim': null,
  "Tony Hawk's Pro Skater 3 + 4": null,
  'Worms Reloaded - WR': 'Worms Reloaded',
};

async function resolveOne(prisma, row) {
  const title = parseOnlineFixDisplayName(row.name, row.fileName);
  const searchName = MANUAL[row.name] || title;
  const hits = await searchSteamStoreByName(searchName);
  const hit =
    hits.find((h) => h.name?.toLowerCase() === searchName.toLowerCase()) ||
    hits.find((h) => h.name?.toLowerCase().includes(searchName.toLowerCase().slice(0, 8))) ||
    hits[0];

  if (!hit?.appid) {
    console.log('[skip]', row.name, 'no steam hit for', searchName);
    return false;
  }

  await prisma.onlineFixGame.update({
    where: { id: row.id },
    data: {
      name: title,
      steamAppId: hit.appid,
      imageUrl: steamHeaderImageUrl(hit.appid),
    },
  });
  console.log('[ok]', row.name, '->', hit.appid, hit.name);
  return true;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const missing = await prisma.onlineFixGame.findMany({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
      select: { id: true, name: true, fileName: true },
    });
    let fixed = 0;
    for (const row of missing) {
      if (await resolveOne(prisma, row)) fixed += 1;
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
