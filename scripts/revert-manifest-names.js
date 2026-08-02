/**
 * Revert Manifest names to App ID placeholder.
 *
 * Targets all rows and changes their `name` to `App <appId>`.
 *
 * Usage:
 *   node scripts/revert-manifest-names.js           # apply updates
 *   node scripts/revert-manifest-names.js --dry-run # preview only, no DB writes
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const PROGRESS_EVERY = 50;
const PLACEHOLDER_PATTERN = /^(?:Manifest|App)\s+\d+$/i;

async function main() {
  console.log('--- OpenSteam: Manifest Name Revert ---');
  console.log(DRY_RUN ? '[DRY-RUN] No DB writes will be performed.' : '[LIVE] Updates will be written to the DB.');

  const rows = await prisma.manifest.findMany({
    select: { id: true, steamAppId: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  // Target any row that doesn't currently equal "App <appId>"
  const targets = rows.filter((r) => r.name !== `App ${r.steamAppId}`);
  console.log(`Scanned ${rows.length} manifests. ${targets.length} need reverting.\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let updated = 0;

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const newName = `App ${row.steamAppId}`;

    if (DRY_RUN) {
      console.log(`[DRY] ${row.steamAppId}: "${row.name}" -> "${newName}"`);
    } else {
      await prisma.manifest.update({
        where: { id: row.id },
        data: { name: newName },
      });
      console.log(`[OK]  ${row.steamAppId}: "${row.name}" -> "${newName}"`);
    }
    updated++;

    if ((i + 1) % PROGRESS_EVERY === 0) {
      console.log(`-- progress: ${i + 1}/${targets.length} (updated=${updated})`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total candidates : ${targets.length}`);
  console.log(`Updated          : ${updated}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Revert failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
