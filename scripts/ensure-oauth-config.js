require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  await prisma.systemConfig.upsert({
    where: { key: 'DISCORD_BOT_FAILOVER_MODE' },
    create: { key: 'DISCORD_BOT_FAILOVER_MODE', value: 'primary', isSecret: false },
    update: { value: 'primary' },
  });
  await prisma.systemConfig.upsert({
    where: { key: 'DISCORD_CLIENT_ID' },
    create: { key: 'DISCORD_CLIENT_ID', value: process.env.DISCORD_CLIENT_ID || '1532867690031484969', isSecret: false },
    update: { value: process.env.DISCORD_CLIENT_ID || '1532867690031484969' },
  });
  await prisma.systemConfig.upsert({
    where: { key: 'DISCORD_CLIENT_SECRET' },
    create: { key: 'DISCORD_CLIENT_SECRET', value: process.env.DISCORD_CLIENT_SECRET || '', isSecret: true },
    update: { value: process.env.DISCORD_CLIENT_SECRET || '', isSecret: true },
  });
  await prisma.$disconnect();
  require('./sync-oauth-urls');
  console.log('OAuth pinned to gen app + http://opensteam.lol');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
