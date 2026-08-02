/**
 * Shared Discord role → platform role mapping for Node scripts (bot-daemon).
 */

function resolvePlatformRoleFromDiscordRoleName(roleName) {
  const nameLower = String(roleName || '').trim().toLowerCase();
  if (!nameLower) return null;

  if (
    nameLower.includes('donator') ||
    nameLower.includes('supporter') ||
    nameLower.includes('booster') ||
    nameLower.includes('nitro')
  ) {
    return null;
  }

  if (nameLower.includes('owner')) return 'OWNER';
  if (nameLower.includes('admin')) return 'ADMIN';
  if (nameLower.includes('senior mod') || nameLower.includes('senior moderator')) {
    return 'SENIOR_MODERATOR';
  }
  if (nameLower.includes('trial mod') || nameLower.includes('trial moderator')) {
    return 'TRIAL_MODERATOR';
  }
  if (nameLower.includes('moderator') || nameLower === 'mod') return 'MODERATOR';

  return null;
}

function isDonatorDiscordRoleName(roleName) {
  const nameLower = String(roleName || '').trim().toLowerCase();
  return nameLower.includes('donator');
}

module.exports = {
  resolvePlatformRoleFromDiscordRoleName,
  isDonatorDiscordRoleName,
};
