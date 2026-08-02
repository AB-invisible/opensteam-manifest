require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- OpenSteam System: Forced Unblocking ---');

  // 1. Clear IP Blacklist
  const deletedBlacklist = await prisma.blacklistedIp.deleteMany({});
  console.log(`[Blacklist] Removed ${deletedBlacklist.count} blacklisted IPs.`);

  // 2. Clear Sentinel Jails and Reset Risk Scores for all users
  const resetUsers = await prisma.user.updateMany({
    data: {
      jailLevel: 0,
      jailUntil: null,
      riskScore: 0,
    }
  });
  console.log(`[Jail] Reset jail status and risk scores for ${resetUsers.count} users.`);

  // 3. Clear all Rate Limit States (temporary hourly/IP jails)
  const deletedStates = await prisma.rateLimitState.deleteMany({});
  console.log(`[RateLimit] Cleared ${deletedStates.count} active rate-limit states/jails.`);

  // 4. Reset all user quotas to max
  const resetQuotas = await prisma.userQuota.updateMany({
    data: {
      monthlyMinutes: 500000,
      currentSessionDuration: 0,
      lastResetDate: new Date(),
    }
  });
  console.log(`[Quotas] Reset quotas for ${resetQuotas.count} users.`);

  console.log('--- Unblocking Complete. All clients should have access now. ---');
}

main()
  .catch(e => {
    console.error('Failed to unblock:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });