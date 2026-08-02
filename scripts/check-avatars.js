const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== Checking User Avatars in Database ===');
  const users = await prisma.user.findMany({
    take: 10,
    select: {
      id: true,
      username: true,
      discordId: true,
      avatar: true
    }
  });

  for (const u of users) {
    console.log(`User: ${u.username} (${u.id})`);
    console.log(`  Discord ID: ${u.discordId}`);
    console.log(`  Avatar:     ${u.avatar}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
