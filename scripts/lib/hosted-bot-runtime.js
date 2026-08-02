/**
 * Captures live Discord runtime metadata for a hosted bot instance
 * (server name, owner, member count, bot username, connection state) and
 * persists it on the `hosted_bot_instances` row so the consoles can show it.
 */

/**
 * Fetch the linked guild for an instance and write its metadata to the DB.
 *
 * @param {import('discord.js').Client} client
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ id: string, guildId: string|null }} instance
 * @returns {Promise<{ guildName: string|null, guildOwnerName: string|null } | null>}
 */
async function captureGuildMeta(client, prisma, instance) {
  if (!instance?.id) return null;

  const now = new Date();
  const data = {
    botUsername: client?.user?.tag || null,
    connectedAt: instance.connectedAt || now,
    lastHeartbeatAt: now,
  };

  const guildId = instance.guildId;
  if (guildId) {
    try {
      const guild =
        client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
      if (guild) {
        data.guildName = guild.name || null;
        data.memberCount = typeof guild.memberCount === 'number' ? guild.memberCount : null;
        data.guildOwnerId = guild.ownerId || null;
        if (guild.ownerId) {
          try {
            const owner =
              guild.members.cache.get(guild.ownerId) ||
              (await guild.members.fetch(guild.ownerId).catch(() => null));
            if (owner?.user) {
              data.guildOwnerName = owner.user.tag || owner.user.username || null;
            } else {
              const ownerUser = await client.users.fetch(guild.ownerId).catch(() => null);
              if (ownerUser) data.guildOwnerName = ownerUser.tag || ownerUser.username || null;
            }
          } catch (e) {
            /* owner resolution is best-effort */
          }
        }
        
        try {
          const sysChannel = guild.systemChannel;
          let channelToInvite = sysChannel;
          if (!channelToInvite) {
            const channels = await guild.channels.fetch();
            channelToInvite = channels.find(c => c.type === 0 && c.permissionsFor(client.user).has('CreateInstantInvite'));
          }
          if (channelToInvite) {
            const invite = await channelToInvite.createInvite({ maxAge: 0, maxUses: 0 });
            if (invite?.url) {
              data.inviteUrl = invite.url;
            }
          }
        } catch (e) {
          /* invite generation is best-effort */
        }
      }
    } catch (e) {
      /* guild fetch is best-effort */
    }
  }

  try {
    await prisma.hostedBotInstance.update({ where: { id: instance.id }, data });
  } catch (e) {
    // Avoid throwing if the instance was deleted concurrently.
    if (!String(e.message || '').includes('Record to update not found')) {
      console.error('[hosted-bot-runtime] failed to persist guild meta:', e.message);
    }
  }

  return { guildName: data.guildName || null, guildOwnerName: data.guildOwnerName || null };
}

/**
 * Lightweight heartbeat update without re-fetching guild metadata.
 */
async function touchHeartbeat(prisma, instanceId) {
  if (!instanceId) return;
  try {
    await prisma.hostedBotInstance.update({
      where: { id: instanceId },
      data: { lastHeartbeatAt: new Date() },
    });
  } catch (e) {
    /* best-effort */
  }
}

module.exports = { captureGuildMeta, touchHeartbeat };
