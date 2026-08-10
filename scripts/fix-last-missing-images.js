require('dotenv').config({ quiet: true });
if (process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.NEON_DATABASE_URL;
}

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { steamHeaderImageUrl, parseOnlineFixDisplayName } = require('./lib/onlinefix-s3');
const { resolveSteamImagesForCatalog, normalizeOnlineFixKey, decodeHtmlEntities } = require('./lib/onlinefix-site');

const MANUAL_STEAM = {
  "Don't Panic! It is Just a Turbulence": 4187140,
  'Timeflow Time & Money Sim': 1005930,
  "Tony Hawk's Pro Skater 3 + 4": 2545710,
};

async function fetchOfficialSearchPoster(title) {
  const q = encodeURIComponent(title.split(' ').slice(0, 3).join(' '));
  const url = `https://online-fix.me/index.php?do=search&subaction=search&story=${q}`;
  const res = await axios.get(url, {
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenSteam/1.0',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (res.status >= 400) return null;

  const html = String(res.data || '');
  const targetKey = normalizeOnlineFixKey(title);
  const blocks = html.match(/<article class="news">[\s\S]*?<\/article>/gi) || [];

  for (const block of blocks) {
    const rawTitle = decodeHtmlEntities(
      block.match(/<h2[^>]*>\s*<a[^>]*>([^<]+)/i)?.[1] || ''
    ).trim();
    if (!rawTitle) continue;
    const parsed = parseOnlineFixDisplayName(rawTitle, null);
    if (normalizeOnlineFixKey(parsed) !== targetKey) continue;

    return {
      imageUrl:
        block.match(/data-src="(https:\/\/online-fix\.me\/uploads\/[^"]+)"/i)?.[1] ||
        block.match(/src="(https:\/\/online-fix\.me\/uploads\/[^"]+)"/i)?.[1] ||
        null,
      sourceUrl: block.match(/href="(https:\/\/online-fix\.me\/games\/[^"]+)"/i)?.[1] || null,
    };
  }

  return null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [name, appId] of Object.entries(MANUAL_STEAM)) {
      const row = await prisma.onlineFixGame.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
      if (!row || row.imageUrl) continue;
      await prisma.onlineFixGame.update({
        where: { id: row.id },
        data: {
          steamAppId: appId,
          imageUrl: steamHeaderImageUrl(appId),
        },
      });
      console.log('[manual steam]', name, appId);
    }

    const pac = await prisma.onlineFixGame.findFirst({
      where: { name: { contains: 'PAC-MAN Mega Tunnel', mode: 'insensitive' } },
    });
    if (pac && !pac.imageUrl) {
      await new Promise((r) => setTimeout(r, 4000));
      const hit = await fetchOfficialSearchPoster('PAC-MAN Mega Tunnel Battle Chomp Champs');
      if (hit?.imageUrl) {
        await prisma.onlineFixGame.update({
          where: { id: pac.id },
          data: { imageUrl: hit.imageUrl, sourceUrl: hit.sourceUrl },
        });
        console.log('[official search]', pac.name, hit.imageUrl);
      } else {
        console.log('[official search] PAC-MAN not found');
      }
    }

    const steam = await resolveSteamImagesForCatalog({ prismaClient: prisma, limit: 20 });
    console.log('[steam pass]', steam);

    const left = await prisma.onlineFixGame.count({
      where: { OR: [{ imageUrl: null }, { imageUrl: '' }] },
    });
    console.log('[remaining]', left);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
