/**
 * Resolve Manifests where `steamAppId` contains the game name instead of the numeric ID.
 *
 * Scans all rows. If `steamAppId` contains non-numeric characters, it attempts to
 * find the true numeric App ID by querying the global Steam App List.
 *
 * Usage:
 *   node scripts/resolve-name-to-appid.js           # apply updates
 *   node scripts/resolve-name-to-appid.js --dry-run # preview only, no DB writes
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function getSteamAppMap() {
  const apiKey = process.env.STEAM_API_KEY;
  const map = new Map();

  if (apiKey) {
    console.log('Fetching Steam App List via authenticated IStoreService (paginated)...');
    let lastAppId = 0;
    let moreResults = true;
    let page = 1;

    while (moreResults) {
      const res = await fetch(`https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${apiKey}&max_results=50000&last_appid=${lastAppId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch Steam App List page ${page}: HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const apps = data?.response?.apps || [];
      
      for (const app of apps) {
        if (app.name) {
          map.set(app.name.toLowerCase().trim(), String(app.appid));
        }
        lastAppId = app.appid;
      }

      moreResults = data?.response?.have_more_results || false;
      if (moreResults) {
        lastAppId = data.response.last_appid;
        page++;
        // Small delay to prevent rate limits on the paginated endpoint
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } else {
    console.warn('WARNING: STEAM_API_KEY is not set. Falling back to the deprecated public GetAppList endpoint.');
    console.warn('This endpoint frequently returns 404 "Not Found" or 403 when called from datacenters (like Railway).');
    const res = await fetch('https://api.steampowered.com/ISteamApps/GetAppList/v2/');
    if (!res.ok) {
      throw new Error(`Failed to fetch Steam App List: ${res.statusText}`);
    }
    const data = await res.json();
    const apps = data?.applist?.apps || [];
    
    for (const app of apps) {
      if (app.name) {
        map.set(app.name.toLowerCase().trim(), String(app.appid));
      }
    }
  }

  console.log(`Loaded ${map.size} unique game names from Steam.`);
  return map;
}

async function main() {
  console.log('--- OpenSteam: Resolve Name to App ID Fix ---');
  console.log(DRY_RUN ? '[DRY-RUN] No DB writes will be performed.' : '[LIVE] Updates will be written to the DB.');

  const rows = await prisma.manifest.findMany({
    select: { id: true, steamAppId: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = rows.filter((r) => !/^\d+$/.test(r.steamAppId));
  console.log(`Scanned ${rows.length} manifests. ${targets.length} have non-numeric steamAppId data.\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const appMap = await getSteamAppMap();
  let updated = 0;
  let notFound = 0;

  for (const row of targets) {
    const gameName = row.steamAppId.trim();
    const foundAppId = appMap.get(gameName.toLowerCase());

    if (foundAppId) {
      if (DRY_RUN) {
        console.log(`[DRY] Match found: "${gameName}" -> AppID ${foundAppId}`);
      } else {
        try {
          await prisma.manifest.update({
            where: { id: row.id },
            data: {
              steamAppId: foundAppId,
              name: gameName
            },
          });
          console.log(`[OK]  Fixed: "${gameName}" is now steamAppId="${foundAppId}", name="${gameName}"`);
          updated++;
        } catch (err) {
          console.error(`[ERR] Failed to update row ID ${row.id}: ${err.message}`);
        }
      }
    } else {
      console.log(`[SKIP] Could not find numeric App ID for name: "${gameName}"`);
      notFound++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total candidates : ${targets.length}`);
  console.log(`Successfully Fixed: ${updated}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
  console.log(`Unmatched Names  : ${notFound}`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
