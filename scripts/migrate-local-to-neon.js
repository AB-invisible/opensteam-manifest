#!/usr/bin/env node
/** Copy essential rows from local Postgres to Neon. */
const { PrismaClient } = require('@prisma/client');

const LOCAL =
  process.env.LOCAL_DATABASE_URL ||
  'postgresql://postgres:bhrhxd57@127.0.0.1:5432/manifest-generator?schema=public';
const REMOTE =
  process.env.NEON_DATABASE_URL ||
  process.argv[2] ||
  process.env.DATABASE_URL;

if (!REMOTE) {
  console.error('Pass Neon DATABASE_URL as arg or NEON_DATABASE_URL env');
  process.exit(1);
}

const local = new PrismaClient({ datasources: { db: { url: LOCAL } } });
const remote = new PrismaClient({ datasources: { db: { url: REMOTE } } });

async function copySystemConfig() {
  const rows = await local.systemConfig.findMany();
  if (!rows.length) {
    console.log('systemConfig: nothing to copy');
    return 0;
  }
  let n = 0;
  for (const row of rows) {
    try {
      await remote.systemConfig.upsert({
        where: { key: row.key },
        create: row,
        update: {
          value: row.value,
          isSecret: row.isSecret,
          updatedAt: row.updatedAt,
        },
      });
      n += 1;
    } catch (err) {
      console.warn(`systemConfig skip ${row.key}:`, err.message);
    }
  }
  console.log(`systemConfig: copied ${n}/${rows.length}`);
  return n;
}

async function copyTable(model, label, upsertFn) {
  const rows = await local[model].findMany();
  if (!rows.length) {
    console.log(`${label}: nothing to copy`);
    return 0;
  }
  let n = 0;
  for (const row of rows) {
    try {
      await upsertFn(row);
      n += 1;
    } catch (err) {
      console.warn(`${label} skip ${row.id || row.key}:`, err.message);
    }
  }
  console.log(`${label}: copied ${n}/${rows.length}`);
  return n;
}

(async () => {
  try {
    await copySystemConfig();
    await copyTable('user', 'users', (row) =>
      remote.user.upsert({ where: { id: row.id }, create: row, update: row }),
    );
    await copyTable('manifest', 'manifests', (row) =>
      remote.manifest.upsert({ where: { id: row.id }, create: row, update: row }),
    );
    console.log('Migration complete.');
  } finally {
    await local.$disconnect();
    await remote.$disconnect();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
