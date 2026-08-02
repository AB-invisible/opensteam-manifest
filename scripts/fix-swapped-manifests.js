/**
 * Fix Manifests with swapped name and steamAppId.
 *
 * Scans all rows. If `steamAppId` contains non-numeric characters (likely the game name)
 * AND `name` contains numbers (or is "App <id>"), it will swap them or fix them to the correct format.
 *
 * Usage:
 *   node scripts/fix-swapped-manifests.js           # apply updates
 *   node scripts/fix-swapped-manifests.js --dry-run # preview only, no DB writes
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('--- OpenSteam: Swapped Manifests Fix ---');
  console.log(DRY_RUN ? '[DRY-RUN] No DB writes will be performed.' : '[LIVE] Updates will be written to the DB.');

  const rows = await prisma.manifest.findMany({
    select: { id: true, steamAppId: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = [];

  for (const row of rows) {
    // If steamAppId is completely numeric, it's fine.
    if (/^\d+$/.test(row.steamAppId)) {
      continue;
    }

    // steamAppId contains non-numeric characters. Check if name looks like an App ID.
    // E.g. name might be "730", "App 730", or "Manifest 730".
    const numericMatch = row.name ? row.name.match(/\d+/) : null;
    
    if (numericMatch) {
      const correctAppId = numericMatch[0];
      // If steamAppId looks like it has the name, let's assume it is the name.
      // But if it's "App Counter-Strike", we might want to strip "App ".
      let correctName = row.steamAppId;
      if (correctName.startsWith('App ')) {
        correctName = correctName.substring(4);
      } else if (correctName.startsWith('Manifest ')) {
        correctName = correctName.substring(9);
      }

      targets.push({
        id: row.id,
        oldSteamAppId: row.steamAppId,
        oldName: row.name,
        newSteamAppId: correctAppId,
        newName: correctName
      });
    }
  }

  console.log(`Scanned ${rows.length} manifests. ${targets.length} have swapped/malformed data to fix.\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let updated = 0;

  for (const target of targets) {
    if (DRY_RUN) {
      console.log(`[DRY] Fix: steamAppId="${target.oldSteamAppId}" -> "${target.newSteamAppId}", name="${target.oldName}" -> "${target.newName}"`);
    } else {
      try {
        await prisma.manifest.update({
          where: { id: target.id },
          data: {
            steamAppId: target.newSteamAppId,
            name: target.newName
          },
        });
        console.log(`[OK]  Fix: steamAppId="${target.oldSteamAppId}" -> "${target.newSteamAppId}", name="${target.oldName}" -> "${target.newName}"`);
        updated++;
      } catch (err) {
        console.error(`[ERR] Failed to update row ID ${target.id}: ${err.message}`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total candidates : ${targets.length}`);
  console.log(`Updated          : ${updated}${DRY_RUN ? ' (dry-run, not written)' : ''}`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Fix failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
