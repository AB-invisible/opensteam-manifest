
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkSmtp() {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const configs = await prisma.systemConfig.findMany({
    where: { key: { in: keys } }
  });

  console.log('SMTP Configurations in Database:');
  keys.forEach(key => {
    const config = configs.find(c => c.key === key);
    console.log(`${key}: ${config ? (config.isSecret ? '••••••••' : config.value) : 'NOT SET'}`);
  });

  console.log('\nSMTP Configurations in Environment:');
  keys.forEach(key => {
    console.log(`${key}: ${process.env[key] ? 'SET' : 'NOT SET'}`);
  });
}

checkSmtp()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
