const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Current Users in Database ---');
  const users = await prisma.user.findMany({
    select: {
      id: true,
      discordId: true,
      username: true,
      role: true,
      isBanned: true,
      jailLevel: true,
      jailUntil: true,
      lastIp: true
    }
  });
  
  console.table(users);
  
  console.log('--- Blacklisted IPs ---');
  const blacklisted = await prisma.blacklistedIp.findMany();
  console.table(blacklisted);

  console.log('--- Active Rate Limit States (Temporary Jails) ---');
  const rateLimits = await prisma.rateLimitState.findMany();
  console.table(rateLimits);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
