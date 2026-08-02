require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const configs = await prisma.systemConfig.findMany();
    console.log('--- System Configs ---');
    configs.forEach(c => {
      if (c.isSecret || c.key.includes('TOKEN') || c.key.includes('SECRET') || c.key.includes('KEY')) {
        console.log(`${c.key}: [REDACTED] (Length: ${c.value ? c.value.length : 0})`);
      } else {
        console.log(`${c.key}: ${c.value}`);
      }
    });
  } catch (e) {
    console.error('Error fetching configs:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
