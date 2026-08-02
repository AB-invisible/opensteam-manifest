require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const guildId = process.argv[2]?.trim();
if (!guildId || !/^\d{17,20}$/.test(guildId)) {
  console.error('Usage: node scripts/set-owner-guild.js <guildId>');
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const previous = await prisma.systemConfig.findUnique({
      where: { key: 'DISCORD_GUILD_ID' },
    });

    await prisma.systemConfig.upsert({
      where: { key: 'DISCORD_GUILD_ID' },
      create: { key: 'DISCORD_GUILD_ID', value: guildId, isSecret: false },
      update: { value: guildId },
    });

    console.log(
      `Manifest bot owner guild: ${previous?.value || '(unset)'} -> ${guildId}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
