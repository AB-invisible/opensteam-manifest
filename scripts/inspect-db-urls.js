require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

async function inspect(url, label) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$connect();
    const rows = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('api_keys', 'device_pairings', 'users', 'Ticket', 'Game')
      ORDER BY table_name`;
    console.log(label + ':', rows.map((r) => r.table_name).join(', ') || '(none)');
  } catch (e) {
    console.log(label + ': ERROR', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await inspect(process.env.NEON_DATABASE_URL, 'NEON_DATABASE_URL');
  await inspect(process.env.DATABASE_URL, 'DATABASE_URL local');
}

main();
