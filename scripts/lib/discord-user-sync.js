const { PermissionFlagsBits } = require('discord.js');

/**
 * Find or create a platform user from a Discord user object.
 * No website sign-in required — Discord identity is enough for bot commands.
 */
async function getOrSyncDiscordUser(prisma, discordUser) {
  if (!discordUser?.id) return null;

  try {
    let user = await prisma.user.findUnique({
      where: { discordId: discordUser.id },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          discordId: discordUser.id,
          username: discordUser.username || discordUser.globalName || 'discord_user',
          discriminator: discordUser.discriminator || '0',
          avatar: discordUser.avatar || null,
          coins: 0,
        },
      });
      return user;
    }

    const nextUsername = discordUser.username || discordUser.globalName;
    if (nextUsername && nextUsername !== user.username) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { username: nextUsername },
      });
    }

    return user;
  } catch (e) {
    console.error('[DiscordUserSync] Error syncing user:', e?.message || e);
    return null;
  }
}

async function resolveGuildMember(message) {
  if (message.member) return message.member;
  if (!message.guild || !message.author?.id) return null;

  try {
    return await message.guild.members.fetch(message.author.id);
  } catch (_) {
    return null;
  }
}

/**
 * Manifest upload channel: platform Admin/Owner OR Discord server Administrator.
 */
async function canUploadManifests(message, prisma) {
  const sender = await getOrSyncDiscordUser(prisma, message.author);
  if (sender && ['ADMIN', 'OWNER'].includes(sender.role)) {
    return { allowed: true, user: sender, reason: 'platform_role' };
  }

  const member = await resolveGuildMember(message);
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
    return { allowed: true, user: sender, reason: 'discord_admin' };
  }

  return { allowed: false, user: sender, reason: 'forbidden' };
}

module.exports = {
  getOrSyncDiscordUser,
  resolveGuildMember,
  canUploadManifests,
};
