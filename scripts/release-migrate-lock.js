const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  const rows = await prisma.$queryRaw`
    SELECT pid, state, query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
  `;
  console.log('Active sessions:', rows.length);
  for (const row of rows) {
    console.log(row.pid, row.state, String(row.query || '').slice(0, 120));
    await prisma.$executeRawUnsafe(`SELECT pg_terminate_backend(${Number(row.pid)})`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
