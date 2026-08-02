/**
 * Maps a Discord guild role name to a platform staff role.
 * Returns null for donator/cosmetic roles and unrecognized names — never grants staff by accident.
 */
export function resolvePlatformRoleFromDiscordRoleName(
  roleName: string
): 'OWNER' | 'ADMIN' | 'SENIOR_MODERATOR' | 'TRIAL_MODERATOR' | 'MODERATOR' | null {
  const nameLower = roleName.trim().toLowerCase();
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

export function isDonatorDiscordRoleName(roleName: string): boolean {
  const nameLower = roleName.trim().toLowerCase();
  return nameLower.includes('donator') || nameLower.includes('donator');
}
