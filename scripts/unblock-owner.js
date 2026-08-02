const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const targetIp = '87.197.90.173';
  console.log(`--- OpenSteam Firewall: Unblocking IP ${targetIp} ---`);

  // Delete from blacklisted IPs
  const deleted = await prisma.blacklistedIp.deleteMany({
    where: { ip: targetIp }
  });
  console.log(`[Firewall] Removed ${deleted.count} instance(s) of ${targetIp} from blacklist.`);

  // Also clear active rate limit states (jails) for this IP
  const deletedStates = await prisma.rateLimitState.deleteMany({
    where: { key: targetIp }
  });
  console.log(`[RateLimit] Cleared ${deletedStates.count} active rate-limit states/jails for ${targetIp}.`);

  console.log('--- Unblocking Complete ---');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
