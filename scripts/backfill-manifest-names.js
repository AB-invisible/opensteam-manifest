/**
 * Backfill Manifest names + header images from Steam.
 *
 * Targets rows whose `name` is the legacy `Manifest <appId>` placeholder
 * and asks Steam's appdetails API for the real game name. Safe to re-run:
 * rows already updated will no longer match the placeholder and are skipped.
 *
 * Usage:
 *   node scripts/backfill-manifest-names.js           # apply updates
 *   node scripts/backfill-manifest-names.js --dry-run # preview only, no DB writes
 *
 * Notes:
 *   - Throttled to ~4 req/sec to stay under Steam's rate limits.
 *   - Skips rows Steam doesn't recognize (leaves name unchanged).
 *   - Crash-safe: rerunning resumes where it left off.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const STEAM_THROTTLE_MS = 250; // ~4 req/sec
const PROGRESS_EVERY = 10;
const PLACEHOLDER_PATTERN = /^(?:Manifest|App)\s+\d+$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSteamName(appId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return { name: null, status: `HTTP_${res.status}` };

    const json = await res.json();
    const node = json?.[appId];

    if (!node) return { name: null, status: 'NO_NODE' };
    if (node.success === false) return { name: null, status: 'NOT_ON_STEAM' };

    const name = node.data?.name ? String(node.data.name).slice(0, 200) : null;
    if (!name) return { name: null, status: 'NO_NAME' };

    return { name, status: 'OK' };
  } catch (err) {
    return { name: null, status: `ERROR_${err.message || 'unknown'}` };
  }
}

async function main() {
  console.log('--- OpenSteam: Manifest Name Backfill ---');
  console.log(DRY_RUN ? '[DRY-RUN] No DB writes will be performed.' : '[LIVE] Updates will be written to the DB.');

  const rows = await prisma.manifest.findMany({
    where: {
      OR: [
        { name: { startsWith: 'Manifest ' } },
        { name: { startsWith: 'App ' } }
      ]
    },
    select: { id: true, steamAppId: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = rows.filter((r) => PLACEHOLDER_PATTERN.test(r.name || ''));
  console.log(`Scanned ${rows.length} manifests. ${targets.length} need backfill.\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let updated = 0;
  let skippedNotOnSteam = 0;
  let skippedErrors = 0;

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const { name, status } = await fetchSteamName(row.steamAppId);

    if (name) {
      if (DRY_RUN) {
        console.log(`[DRY] ${row.steamAppId}: "${row.name}" -> "${name}"`);
      } else {
        await prisma.manifest.update({
          where: { id: row.id },
          data: { name },
        });
        console.log(`[OK]  ${row.steamAppId}: "${row.name}" -> "${name}"`);
      }
      updated++;
    } else if (status === 'NOT_ON_STEAM' || status === 'NO_NAME' || status === 'NO_NODE') {
      console.log(`[SKIP] ${row.steamAppId}: not on Steam (${status})`);
      skippedNotOnSteam++;
    } else {
      console.log(`[ERR]  ${row.steamAppId}: ${status}`);
      skippedErrors++;
    }

    if ((i + 1) % PROGRESS_EVERY === 0) {
      console.log(`-- progress: ${i + 1}/${targets.length} (updated=${updated}, skipped=${skippedNotOnSteam}, errors=${skippedErrors})`);
    }

    await sleep(STEAM_THROTTLE_MS);
  }

  console.log('\n--- Summary ---');
  console.log(`Total candidates : ${targets.length}`);
  console.log(`Updated          : ${updated}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
  console.log(`Skipped (no Steam): ${skippedNotOnSteam}`);
  console.log(`Errors           : ${skippedErrors}`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
