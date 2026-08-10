#!/usr/bin/env node
/**
 * Create isolated opensteam_manifest DB on Neon (same project) and run prisma migrate deploy.
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ROOT = path.join(__dirname, '..');
const NEON = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const MANIFEST_DB = process.env.MANIFEST_DATABASE_NAME || 'opensteam_manifest';

if (!NEON) {
  console.error('NEON_DATABASE_URL missing');
  process.exit(1);
}

function manifestDbUrl() {
  const u = new URL(NEON);
  u.pathname = `/${MANIFEST_DB}`;
  return u.toString();
}

function adminUrl() {
  const u = new URL(NEON);
  u.pathname = '/neondb';
  return u.toString();
}

async function ensureDatabase() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
  try {
    await admin.$connect();
    const rows = await admin.$queryRaw`
      SELECT 1 FROM pg_database WHERE datname = ${MANIFEST_DB}`;
    if (rows.length) {
      console.log(`[manifest-db] Database ${MANIFEST_DB} already exists.`);
      return;
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE "${MANIFEST_DB}"`);
    console.log(`[manifest-db] Created database ${MANIFEST_DB}.`);
  } finally {
    await admin.$disconnect();
  }
}

function runSchemaPush(url) {
  const env = { ...process.env, DATABASE_URL: url };
  console.log('[manifest-db] prisma db push (full schema)...');
  const r = spawnSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    shell: true,
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) process.exit(r.status || 1);
}

async function verify(url) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$connect();
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'api_keys', 'device_pairings')
      ORDER BY table_name`;
    console.log('[manifest-db] tables:', tables.map((t) => t.table_name).join(', '));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await ensureDatabase();
  const url = manifestDbUrl();
  console.log('[manifest-db] Running migrations on', MANIFEST_DB);
  runSchemaPush(url);
  await verify(url);
  console.log('[manifest-db] MANIFEST_DATABASE_URL=' + url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
