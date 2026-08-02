async function validateHostedGuildLink(prisma, { actingUserId, targetGuildId, linkType, instance }) {
  if (instance?.guildId && instance.guildId !== targetGuildId) {
    return {
      ok: false,
      error:
        '❌ Your OpenSteam account is already linked to a different server. Unlink from the dashboard first.',
    };
  }

  const existing = await prisma.hostedBotInstance.findUnique({
    where: { guildId: targetGuildId },
    select: { userId: true, type: true },
  });

  if (existing && existing.userId !== actingUserId) {
    const otherLabel = existing.type === 'CUSTOM' ? 'custom' : 'branded';
    return {
      ok: false,
      error: `❌ This server is already linked to another OpenSteam account (${otherLabel} bot). Only one OpenSteam bot is allowed per server.`,
    };
  }

  if (existing && existing.type !== linkType) {
    const otherLabel = existing.type === 'CUSTOM' ? 'custom' : 'branded';
    return {
      ok: false,
      error: `❌ This server already has a OpenSteam ${otherLabel} bot linked. Only one OpenSteam bot type is allowed per server.`,
    };
  }

  return { ok: true };
}

async function getActiveCustomLinkedGuildIds(prisma) {
  const rows = await prisma.hostedBotInstance.findMany({
    where: { type: 'CUSTOM', status: 'ACTIVE', guildId: { not: null } },
    select: { guildId: true },
  });
  return rows.map((r) => r.guildId).filter(Boolean);
}

async function getActiveBrandedLinkedGuildIds(prisma) {
  const rows = await prisma.hostedBotInstance.findMany({
    where: { type: 'BRANDED', status: 'ACTIVE', guildId: { not: null } },
    select: { guildId: true },
  });
  return rows.map((r) => r.guildId).filter(Boolean);
}

async function enforceCustomBotSingleGuild(client, prisma, instance) {
  const linkedGuildId = instance?.guildId || null;
  const brandedGuilds = new Set(await getActiveBrandedLinkedGuildIds(prisma));
  const guilds = [...client.guilds.cache.values()];

  if (guilds.length === 0) return;

  if (linkedGuildId) {
    for (const guild of guilds) {
      if (guild.id !== linkedGuildId || brandedGuilds.has(guild.id)) {
        console.log(`[Hosted Custom] Leaving guild ${guild.id} (linked guild: ${linkedGuildId})`);
        await guild.leave().catch(() => {});
      }
    }
    return;
  }

  const eligible = guilds.filter((g) => !brandedGuilds.has(g.id));
  if (eligible.length === 0) {
    for (const guild of guilds) {
      console.log(`[Hosted Custom] Leaving guild ${guild.id} (branded bot linked)`);
      await guild.leave().catch(() => {});
    }
    return;
  }

  const keep = eligible[0];
  for (const guild of guilds) {
    if (guild.id !== keep.id) {
      console.log(`[Hosted Custom] Leaving extra guild ${guild.id} before link`);
      await guild.leave().catch(() => {});
    }
  }
}

async function enforceBrandedBotCustomExclusion(client, prisma) {
  const customGuilds = new Set(await getActiveCustomLinkedGuildIds(prisma));
  for (const guild of client.guilds.cache.values()) {
    if (customGuilds.has(guild.id)) {
      console.log(`[Hosted Branded] Leaving guild ${guild.id} (custom bot linked)`);
      await guild.leave().catch(() => {});
    }
  }
}

module.exports = {
  validateHostedGuildLink,
  enforceCustomBotSingleGuild,
  enforceBrandedBotCustomExclusion,
};
