/**
 * Core OpenSteam Discord account merge: old user → new user (survivor), then delete old.
 * All DB writes run in a single Prisma transaction.
 */

const ENTITLEMENT_FIELDS = [
  'role',
  'roleLevel',
  'plan',
  'planExpiry',
  'planIsCanceled',
  'trialStartDate',
  'trialWelcomeDmDeliveredAt',
  'trialModEndsAt',
  'modTestReadyAt',
  'customDailyLimit',
  'customWebDailyLimit',
  'customMinuteLimit',
  'customAllowMorrenus',
  'customAllowRyuu',
  'coins',
  'isBanned',
  'jailLevel',
  'jailUntil',
  'riskScore',
  'securityBypass',
  'webhookUrl',
  'webhookSecret',
  'discordVerifiedAt',
  'verifyIp',
  'verifyCountry',
  'verifyFingerprint',
  'discordAccountCreatedAt',
  'discordConnections',
  'discordGuildsSnapshot',
  'discordRelationshipsSnapshot',
  'discordGlobalName',
  'discordLocale',
  'discordPremiumType',
  'discordMfaEnabled',
  'discordEmailVerified',
  'discordPublicFlags',
  'discordProfileSnapshot',
];

const USER_COUNT_SELECT = {
  apiKeys: true,
  manifests: true,
  webGenerations: true,
  gameRequests: true,
  keyDonations: true,
  sentinelLogs: true,
  scripts: true,
  profiles: true,
  stars: true,
  memberships: true,
  ownedOrgs: true,
  vouchers: true,
  redemptions: true,
  adminChatMessages: true,
  trialTests: true,
  appSessions: true,
  supportTickets: true,
  memberMarketOrders: true,
  steamAccountOrders: true,
};

/**
 * Fetch user with relation counts for CLI preview.
 */
async function fetchUserPreview(prisma, discordId) {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      hostedBotInstance: { select: { id: true, type: true, status: true } },
      _count: { select: USER_COUNT_SELECT },
    },
  });
  if (!user) return null;

  const [punishmentCount, warnCount] = await Promise.all([
    prisma.punishment.count({ where: { discordId } }),
    prisma.punishment.count({ where: { discordId, type: 'WARN' } }),
  ]);

  return { ...user, punishmentCount, warnCount };
}

/**
 * Resolve duplicate rows on new user before reassigning old user's rows.
 */
async function resolveUniqueCollisions(tx, oldId, newId) {
  const oldMemberships = await tx.orgMembership.findMany({
    where: { userId: oldId },
    select: { orgId: true },
  });
  if (oldMemberships.length > 0) {
    const orgIds = oldMemberships.map((m) => m.orgId);
    await tx.orgMembership.deleteMany({
      where: { userId: newId, orgId: { in: orgIds } },
    });
  }

  const oldStars = await tx.scriptStar.findMany({
    where: { userId: oldId },
    select: { scriptId: true },
  });
  if (oldStars.length > 0) {
    const scriptIds = oldStars.map((s) => s.scriptId);
    await tx.scriptStar.deleteMany({
      where: { userId: newId, scriptId: { in: scriptIds } },
    });
  }

  const [oldManifests, newManifests] = await Promise.all([
    tx.manifest.findMany({ where: { userId: oldId }, select: { steamAppId: true } }),
    tx.manifest.findMany({ where: { userId: newId }, select: { id: true, steamAppId: true } }),
  ]);
  const oldAppIds = new Set(oldManifests.map((m) => m.steamAppId));
  const duplicateNew = newManifests.filter((m) => oldAppIds.has(m.steamAppId));
  if (duplicateNew.length > 0) {
    await tx.manifest.deleteMany({
      where: { id: { in: duplicateNew.map((m) => m.id) } },
    });
  }
}

async function reassignUserIdRows(tx, oldId, newId) {
  const simpleUpdates = [
    () => tx.apiKey.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.manifest.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.gameRequest.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.webGeneration.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.keyDonation.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.sentinelLog.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.extensionScript.updateMany({ where: { authorId: oldId }, data: { authorId: newId } }),
    () => tx.manifestProfile.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.scriptStar.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.orgMembership.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.adminChatMessage.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.appSession.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.memberMarketOrder.updateMany({ where: { createdById: oldId }, data: { createdById: newId } }),
    () => tx.steamAccountOrder.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.supportTicket.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.auditLog.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.organization.updateMany({ where: { creatorId: oldId }, data: { creatorId: newId } }),
    () => tx.organization.updateMany({ where: { resellerId: oldId }, data: { resellerId: newId } }),
    () => tx.voucher.updateMany({ where: { creatorId: oldId }, data: { creatorId: newId } }),
    () => tx.voucher.updateMany({ where: { usedById: oldId }, data: { usedById: newId } }),
    () => tx.trialTest.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
    () => tx.trialTest.updateMany({ where: { adminId: oldId }, data: { adminId: newId } }),
    () => tx.trialTest.updateMany({ where: { reviewedByUserId: oldId }, data: { reviewedByUserId: newId } }),
    () => tx.user.updateMany({ where: { parentId: oldId }, data: { parentId: newId } }),
    () => tx.user.updateMany({ where: { shadowingId: oldId }, data: { shadowingId: newId } }),
    () => tx.comment.updateMany({ where: { userId: oldId }, data: { userId: newId } }),
  ];

  for (const run of simpleUpdates) {
    await run();
  }

  await tx.$executeRaw`UPDATE manifest_versions SET "userId" = ${newId} WHERE "userId" = ${oldId}`;
}

async function reassignHostedBot(tx, oldId, newId) {
  const [oldBot, newBot] = await Promise.all([
    tx.hostedBotInstance.findUnique({ where: { userId: oldId } }),
    tx.hostedBotInstance.findUnique({ where: { userId: newId } }),
  ]);

  if (newBot) {
    await tx.hostedBotInstance.delete({ where: { userId: newId } });
  }

  if (oldBot) {
    await tx.hostedBotInstance.update({
      where: { userId: oldId },
      data: { userId: newId },
    });
  }
}

async function updateDiscordIdKeyedRows(tx, oldId, newId, oldDiscordId, newDiscordId) {
  await tx.punishment.updateMany({
    where: { discordId: oldDiscordId },
    data: { discordId: newDiscordId, userId: newId },
  });

  await tx.discordVerificationSession.updateMany({
    where: { discordId: oldDiscordId },
    data: { discordId: newDiscordId },
  });

  await tx.verificationAuditLog.updateMany({
    where: { discordId: oldDiscordId },
    data: { discordId: newDiscordId },
  });

  await tx.auditLog.updateMany({
    where: { targetId: oldDiscordId },
    data: { targetId: newDiscordId },
  });

  await tx.auditLog.updateMany({
    where: { targetId: oldId },
    data: { targetId: newId },
  });
}

function buildEntitlementPayload(oldUser) {
  const data = {};
  for (const field of ENTITLEMENT_FIELDS) {
    if (oldUser[field] !== undefined) {
      data[field] = oldUser[field];
    }
  }
  data.discordAccessToken = null;
  data.discordRefreshToken = null;
  return data;
}

/**
 * Merge old account into new account and delete old user.
 * @returns {{ oldUser, newUser, stats }}
 */
async function transferDiscordAccount(prisma, oldDiscordId, newDiscordId) {
  const oldUser = await prisma.user.findUnique({ where: { discordId: oldDiscordId } });
  const newUser = await prisma.user.findUnique({ where: { discordId: newDiscordId } });

  if (!oldUser) {
    throw new Error(`Old account not found for Discord ID ${oldDiscordId}`);
  }
  if (!newUser) {
    throw new Error(
      `New account not found for Discord ID ${newDiscordId}. The user must log in to http://127.0.0.1:3000 at least once.`
    );
  }
  if (oldUser.id === newUser.id) {
    throw new Error('Old and new Discord IDs resolve to the same account.');
  }

  const oldId = oldUser.id;
  const newId = newUser.id;
  const stats = { reassigned: {}, deletedOldUser: false };

  await prisma.$transaction(async (tx) => {
    await resolveUniqueCollisions(tx, oldId, newId);
    await reassignHostedBot(tx, oldId, newId);
    await reassignUserIdRows(tx, oldId, newId);
    await updateDiscordIdKeyedRows(tx, oldId, newId, oldDiscordId, newDiscordId);

    await tx.user.update({
      where: { id: newId },
      data: buildEntitlementPayload(oldUser),
    });

    await tx.sentinelLog.create({
      data: {
        userId: newId,
        action: 'ACCOUNT_TRANSFER',
        score: 0,
        reason: 'Discord account transfer completed by staff CLI',
        details: {
          operator: 'SYSTEM_TRANSFER',
          oldDiscordId,
          newDiscordId,
          oldInternalId: oldId,
          transferredAt: new Date().toISOString(),
          transferredPlan: oldUser.plan,
          transferredRole: oldUser.role,
        },
      },
    });

    await tx.user.delete({ where: { id: oldId } });
    stats.deletedOldUser = true;
  });

  const updatedNewUser = await prisma.user.findUnique({
    where: { id: newId },
    include: { hostedBotInstance: true },
  });

  return {
    oldUser,
    newUser: updatedNewUser,
    stats,
  };
}

module.exports = {
  fetchUserPreview,
  transferDiscordAccount,
  USER_COUNT_SELECT,
};
