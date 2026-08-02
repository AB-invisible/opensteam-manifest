require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const pairs = [
    ['DISCORD_BOT_TOKEN', process.env.DISCORD_BOT_TOKEN, true],
    ['DISCORD_CLIENT_ID', process.env.DISCORD_CLIENT_ID, false],
    ['DISCORD_CLIENT_SECRET', process.env.DISCORD_CLIENT_SECRET, true],
    ['DISCORD_GUILD_ID', process.env.DISCORD_GUILD_ID, false],
  ];

  for (const [key, value, isSecret] of pairs) {
    if (!value) {
      console.warn(`Skipping ${key} — not in .env`);
      continue;
    }
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value, isSecret: !!isSecret },
      update: { value, isSecret: !!isSecret },
    });
    console.log(`Seeded ${key}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
