const { PermissionFlagsBits } = require('discord.js');

const PROTECTED_DB_ROLES = new Set([
  'TRIAL_MODERATOR',
  'MODERATOR',
  'SENIOR_MODERATOR',
  'HEAD_MODERATOR',
  'EXECUTIVE_OFFICER',
  'ADMIN',
  'OWNER',
]);

const PROTECTED_PERMISSION_FLAGS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
].filter(Boolean);

const PROTECTED_ROLE_NAME_RE = /\b(owner|admin|administrator|staff|mod|moderator|head mod|senior mod|trial mod|executive)\b/i;

/**
 * Returns a user-facing block reason when a member must not be muted, heckled, or shop-timed-out.
 */
async function getProtectedModerationReason(prisma, targetUser, targetMember, options = {}) {
  const action = String(options.action || 'moderate').toLowerCase();
  const actionLabel =
    action === 'mute' || action === 'timeout'
      ? 'mute or timeout'
      : action === 'heckle'
        ? 'heckle'
        : 'target with this perk';

  if (!targetUser || !targetMember) {
    return 'Target user is not in the server.';
  }
  if (targetUser.bot) {
    return 'Bots cannot be targeted.';
  }

  const dbTarget = await prisma.user
    .findUnique({
      where: { discordId: targetUser.id },
      select: { role: true },
    })
    .catch(() => null);

  if (dbTarget?.role && PROTECTED_DB_ROLES.has(dbTarget.role)) {
    return `You cannot ${actionLabel} OpenSteam moderators or staff members.`;
  }

  if (PROTECTED_PERMISSION_FLAGS.some((flag) => targetMember.permissions.has(flag))) {
    return `You cannot ${actionLabel} members with moderator permissions.`;
  }

  const protectedRole = targetMember.roles.cache.find(
    (role) => role.id !== targetMember.guild.id && PROTECTED_ROLE_NAME_RE.test(role.name),
  );
  if (protectedRole) {
    return `You cannot ${actionLabel} members with the ${protectedRole.name} role.`;
  }

  return null;
}

module.exports = {
  PROTECTED_DB_ROLES,
  getProtectedModerationReason,
};
