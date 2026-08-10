require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const email = process.argv[2] || 'ayoubhaddqr@gmail.com';
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL } },
  });
  await prisma.$connect();
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { username: { contains: 'invisible', mode: 'insensitive' } },
      ],
    },
    select: { id: true, discordId: true, username: true, email: true, role: true, plan: true },
  });
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
