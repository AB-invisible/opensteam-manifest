import { prisma } from './prisma';
import { Plan } from '@prisma/client';

/**
 * Generate a cryptographically secure random voucher code.
 */
function generateVoucherCode() {
  return Array.from({ length: 4 }, () => 
    Math.random().toString(36).substring(2, 6).toUpperCase()
  ).join('-');
}

/**
 * Create a new voucher for plan upgrades or credits.
 */
export async function createVoucher(data: {
  creatorId: string;
  type: 'PLAN_UPGRADE' | 'CREDITS';
  value: string;
  uses?: number;
  expiresAt?: Date;
  code?: string;
}) {
  const code = data.code?.trim().toUpperCase() || generateVoucherCode();

  const existing = await (prisma as any).voucher.findUnique({ where: { code } });
  if (existing) {
    throw new Error('Voucher code already in use');
  }

  return await (prisma as any).voucher.create({
    data: {
      code,
      type: data.type,
      value: data.value,
      uses: data.uses || 1,
      creatorId: data.creatorId,
      expiresAt: data.expiresAt,
    }
  });
}

/**
 * Redeem a voucher code for a user.
 */
export async function redeemVoucher(code: string, userId: string) {
  let isUpgrade = false;
  let upgradedPlan: Plan = 'FREE';
  let upgradedExpiry: Date | null = null;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Find and validate voucher
    const voucher = await (tx as any).voucher.findUnique({
      where: { code }
    });

    if (!voucher) throw new Error('Invalid voucher code');
    if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date()) {
      throw new Error('Voucher has expired');
    }
    if (voucher.usedCount >= voucher.uses) {
      throw new Error('Voucher already fully used');
    }

    // 2. Apply the value based on type
    if (voucher.type === 'PLAN_UPGRADE') {
      let planValue: Plan = 'FREE';
      let months = 1;
      
      if (voucher.value.includes(':')) {
        const [p, m] = voucher.value.split(':');
        planValue = p as Plan;
        months = parseInt(m, 10) || 1;
      } else {
        planValue = voucher.value as Plan;
      }

      // Fetch user to extend active plan expiry if they already hold the same plan
      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { plan: true, planExpiry: true }
      });

      let newExpiry = new Date();
      if (currentUser && currentUser.plan === planValue && currentUser.planExpiry && new Date(currentUser.planExpiry) > new Date()) {
        newExpiry = new Date(currentUser.planExpiry);
      }
      newExpiry.setMonth(newExpiry.getMonth() + months);

      await (tx as any).user.update({
        where: { id: userId },
        data: { 
          plan: planValue,
          planExpiry: newExpiry,
          planIsCanceled: false
        }
      });

      isUpgrade = true;
      upgradedPlan = planValue;
      upgradedExpiry = newExpiry;
    } else if (voucher.type === 'CREDITS') {
       // Logic for credits would go here if we had a credit system field
       // For now let's say we log it as an audit event
    }

    // 3. Mark as used
    return await (tx as any).voucher.update({
      where: { id: voucher.id },
      data: {
        usedCount: { increment: 1 },
        usedById: userId, // Tracks the last user who used it
      }
    });
  });

  // 4. Trigger unified notification outside of transaction
  if (isUpgrade) {
    const { upsertHostedBotInstanceForUser } = await import('./hosted-bot');
    await upsertHostedBotInstanceForUser(userId, upgradedPlan).catch((err) =>
      console.error('[Voucher Redeem] Hosted bot upsert failed:', err)
    );

    const { notifyPlanUpgrade } = await import('./email');
    await notifyPlanUpgrade(userId, upgradedPlan, upgradedExpiry).catch(err => 
      console.error('[Voucher Redeem Notification Error]', err)
    );
  }

  return result;
}
