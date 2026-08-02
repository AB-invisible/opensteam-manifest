require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const [manifests, users, configs] = await Promise.all([
      prisma.manifest.count(),
      prisma.user.count(),
      prisma.systemConfig.findMany({
        where: {
          OR: [
            { key: { contains: 'DISCORD' } },
            { key: { contains: 'UPLOAD' } },
          ],
        },
        select: { key: true, value: true },
        orderBy: { key: 'asc' },
      }),
    ]);

    console.log('Database:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'));
    console.log('Manifest rows:', manifests);
    console.log('User rows:', users);
    console.log('');
    console.log('Discord / upload config:');
    for (const row of configs) {
      const value = row.key.toLowerCase().includes('token') ? '***' : row.value;
      console.log(`  ${row.key} = ${value}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
