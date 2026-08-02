const BRANDED_PLANS = ['REGULAR', 'PREMIUM'];
const CUSTOM_PLANS = ['RESELLER', 'BUSINESS'];

function isPlatformOwner(user) {
  return user?.role === 'OWNER';
}

function isBusinessPlanActive(user) {
  if (user.plan !== 'BUSINESS') return true;
  if (user.planIsCanceled) return false;
  if (user.planExpiry && new Date(user.planExpiry) < new Date()) return false;
  return true;
}

function isHostedBotPlanActive(user) {
  if (isPlatformOwner(user)) return true;
  if (BRANDED_PLANS.includes(user.plan) || CUSTOM_PLANS.includes(user.plan)) {
    if (user.plan === 'BUSINESS') return isBusinessPlanActive(user);
    return true;
  }
  return false;
}

function canLinkBrandedHostedBot(user) {
  if (!user || user.isBanned) return false;
  if (isPlatformOwner(user)) return true;
  if (!BRANDED_PLANS.includes(user.plan)) return false;
  return isHostedBotPlanActive(user);
}

function getBrandedLinkPlanError(user) {
  if (!user) return 'OpenSteam account not found.';
  if (user.plan === 'RESELLER' || user.plan === 'BUSINESS') {
    return (
      'Your **RESELLER/BUSINESS** plan uses a **Custom Bot** (your own Discord app), not the shared branded bot. ' +
      'Open **Dashboard → Custom Bot** and run `/link` on your bot instead.'
    );
  }
  if (user.plan === 'FREE') {
    return (
      'Branded bot requires a **REGULAR** or **PREMIUM** plan. Upgrade at http://127.0.0.1:3000/pricing, ' +
      'then run `/link` with the **same Discord account** you use on OpenSteam. ' +
      'If someone else bought the plan, they must run `/link` in this server.'
    );
  }
  return (
    `Branded bot requires **REGULAR** or **PREMIUM** (your plan: **${user.plan}**). ` +
    'Visit http://127.0.0.1:3000/pricing or contact support if you already paid.'
  );
}

function isPurchaserPlanValid(instance, purchaser) {
  if (!purchaser || purchaser.isBanned) return false;
  if (isPlatformOwner(purchaser)) return true;
  if (instance.type === 'BRANDED') {
    return BRANDED_PLANS.includes(purchaser.plan);
  }
  if (instance.type === 'CUSTOM') {
    if (!CUSTOM_PLANS.includes(purchaser.plan)) return false;
    if (purchaser.plan === 'BUSINESS') return isBusinessPlanActive(purchaser);
    return true;
  }
  return false;
}

module.exports = {
  BRANDED_PLANS,
  CUSTOM_PLANS,
  canLinkBrandedHostedBot,
  getBrandedLinkPlanError,
  isHostedBotPlanActive,
  isPurchaserPlanValid,
  isPlatformOwner,
};
