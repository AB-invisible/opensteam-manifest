const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const endpoints = await prisma.apiUsage.groupBy({
    by: ['endpoint'],
    _count: { endpoint: true }
  });
  console.log(JSON.stringify(endpoints.slice(0, 100), null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
