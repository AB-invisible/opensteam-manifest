import { describe, expect, it } from 'vitest';
import {
  isDonatorDiscordRoleName,
  resolvePlatformRoleFromDiscordRoleName,
} from '@/app/lib/discord-role-mapping';

describe('resolvePlatformRoleFromDiscordRoleName', () => {
  it('maps staff roles correctly', () => {
    expect(resolvePlatformRoleFromDiscordRoleName('Owner')).toBe('OWNER');
    expect(resolvePlatformRoleFromDiscordRoleName('Admin Team')).toBe('ADMIN');
    expect(resolvePlatformRoleFromDiscordRoleName('Senior Moderator')).toBe('SENIOR_MODERATOR');
    expect(resolvePlatformRoleFromDiscordRoleName('Trial Mod')).toBe('TRIAL_MODERATOR');
    expect(resolvePlatformRoleFromDiscordRoleName('Moderator')).toBe('MODERATOR');
    expect(resolvePlatformRoleFromDiscordRoleName('mod')).toBe('MODERATOR');
  });

  it('returns null for donator and cosmetic roles', () => {
    expect(resolvePlatformRoleFromDiscordRoleName('Donator')).toBeNull();
    expect(resolvePlatformRoleFromDiscordRoleName('Super Donator')).toBeNull();
    expect(resolvePlatformRoleFromDiscordRoleName('Supporter')).toBeNull();
    expect(resolvePlatformRoleFromDiscordRoleName('Server Booster')).toBeNull();
    expect(resolvePlatformRoleFromDiscordRoleName('Nitro Booster')).toBeNull();
  });

  it('returns null for unrecognized roles', () => {
    expect(resolvePlatformRoleFromDiscordRoleName('Member')).toBeNull();
    expect(resolvePlatformRoleFromDiscordRoleName('')).toBeNull();
  });
});

describe('isDonatorDiscordRoleName', () => {
  it('detects donator role names', () => {
    expect(isDonatorDiscordRoleName('Donator')).toBe(true);
    expect(isDonatorDiscordRoleName('Super Donator')).toBe(true);
    expect(isDonatorDiscordRoleName('Moderator')).toBe(false);
  });
});
