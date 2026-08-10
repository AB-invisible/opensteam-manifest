require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  const table = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'device_pairings'
    ) AS e`;
  const machineCol = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'machineId'
    ) AS e`;
  const apiKeysTable = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AS e`;
  const cols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
    ORDER BY column_name`;
  console.log('device_pairings:', Boolean(table[0]?.e));
  console.log('api_keys table:', Boolean(apiKeysTable[0]?.e));
  console.log('api_keys.machineId:', Boolean(machineCol[0]?.e));
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
    LIMIT 30`;
  console.log('sample tables:', tables.map((r) => r.table_name).join(', '));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
