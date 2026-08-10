require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const VERIFY_CHANNEL_ID = '1532910591264423988';
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXTAUTH_URL ||
  'https://manifest-web-ylio.onrender.com';

async function main() {
  const dbUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (!dbUrl) throw new Error('NEON_DATABASE_URL or DATABASE_URL is required');
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const pairs = [
    ['DISCORD_VERIFY_ENABLED', 'true', false],
    ['DISCORD_VERIFY_CHANNEL_ID', VERIFY_CHANNEL_ID, false],
    ['DISCORD_VERIFY_BANNER_URL', `${APP_URL.replace(/\/$/, '')}/opensteam.png`, false],
    ['DISCORD_UNVERIFIED_ROLE_ID', '1532919070473584840', false],
    ['DISCORD_VERIFIED_ROLE_ID', '1532912441954926603', false],
    ['DISCORD_ALERTS_CHANNEL_ID', '1536150448942219345', false],
  ];

  for (const [key, value, isSecret] of pairs) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value, isSecret: !!isSecret },
      update: { value, isSecret: !!isSecret },
    });
    console.log(`Seeded ${key}=${value}`);
  }

  for (const key of ['DISCORD_VERIFY_MESSAGE_ID', 'DISCORD_BACKUP_VERIFY_MESSAGE_ID']) {
    try {
      await prisma.systemConfig.delete({ where: { key } });
      console.log(`Cleared ${key} (bot will repost verify panel)`);
    } catch {
      // not set
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
