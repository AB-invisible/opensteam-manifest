#!/usr/bin/env node
/**
 * Sync local STORAGE_PATH/manifests zips into Postgres Manifest rows.
 *
 * Usage:
 *   node scripts/sync-storage-manifests.js
 *   node scripts/sync-storage-manifests.js --dry-run
 *   node scripts/sync-storage-manifests.js --limit 100
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const { syncStorageManifestsToDb, getManifestsRoot } = require('./lib/sync-storage-manifests');
const { fetchSteamAppList } = require('./lib/steam-app-list');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Number.parseInt(args[limitIdx + 1] || '0', 10) : 0;

async function buildNameLookup() {
  try {
    const apps = await fetchSteamAppList();
    const map = new Map(apps.map((app) => [String(app.appid), app.name]));
    return (appId) => map.get(String(appId));
  } catch (err) {
    console.warn('[StorageSync] Steam name lookup skipped:', err.message);
    return () => undefined;
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(`[StorageSync] Scanning ${getManifestsRoot()}`);
    if (dryRun) console.log('[StorageSync] Dry run — no database writes');

    const nameLookup = await buildNameLookup();
    const started = Date.now();
    let lastLog = 0;

    const result = await syncStorageManifestsToDb(prisma, {
      dryRun,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
      onProgress: ({ added, pending, scanned }) => {
        if (added - lastLog >= 5000 || added === pending) {
          lastLog = added;
          console.log(`[StorageSync] ${added}/${pending} inserted (${scanned} on disk)`);
        }
      },
      nameLookup,
    });

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log('[StorageSync] Done in', secs, 's');
    console.log(`  On disk:     ${result.scanned}`);
    console.log(`  Already DB:  ${result.alreadyInDb}`);
    console.log(`  Added:       ${result.added}${dryRun ? ' (dry run)' : ''}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[StorageSync] Failed:', err.message || err);
  process.exit(1);
});
