/**
 * Sync Discord guild roles after account transfer (plan, staff, verification).
 *
 * Primary strategy: copy non-managed roles from the OLD Discord member.
 * Fallback: SystemConfig role IDs, then guild role name matching from platform plan/role.
 */

const VERIFY_DEFAULTS = {
  UNVERIFIED_ROLE_ID: '1532919070473584840',
  VERIFIED_ROLE_ID: '1532912441954926603',
};

const PLAN_ROLE_PATTERNS = {
  REGULAR: ['regular'],
  PREMIUM: ['premium'],
  RESELLER: ['reseller'],
  BUSINESS: ['business'],
  CUSTOM: ['custom'],
};

const STAFF_ROLE_PATTERNS = {
  OWNER: ['owner'],
  ADMIN: ['admin'],
  SENIOR_MODERATOR: ['senior mod', 'senior moderator'],
  TRIAL_MODERATOR: ['trial mod', 'trial moderator'],
  MODERATOR: ['moderator'],
  USER: [],
};

/** Optional SystemConfig / env keys for explicit role IDs (fallback when name match fails). */
const CONFIG_ROLE_KEYS = {
  REGULAR: 'DISCORD_PLAN_ROLE_REGULAR',
  PREMIUM: 'DISCORD_PLAN_ROLE_PREMIUM',
  RESELLER: 'DISCORD_PLAN_ROLE_RESELLER',
  BUSINESS: 'DISCORD_PLAN_ROLE_BUSINESS',
  CUSTOM: 'DISCORD_PLAN_ROLE_CUSTOM',
  TRIAL_MODERATOR: 'DISCORD_STAFF_ROLE_TRIAL_MODERATOR',
  MODERATOR: 'DISCORD_STAFF_ROLE_MODERATOR',
  SENIOR_MODERATOR: 'DISCORD_STAFF_ROLE_SENIOR_MODERATOR',
  ADMIN: 'DISCORD_STAFF_ROLE_ADMIN',
  OWNER: 'DISCORD_STAFF_ROLE_OWNER',
};

async function getConfigValue(prisma, key) {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value || process.env[key] || null;
}

async function loadDiscordConfig(prisma) {
  const [guildId, botToken, unverifiedRoleId, verifiedRoleId] = await Promise.all([
    getConfigValue(prisma, 'DISCORD_GUILD_ID'),
    getConfigValue(prisma, 'DISCORD_BOT_TOKEN'),
    getConfigValue(prisma, 'DISCORD_UNVERIFIED_ROLE_ID'),
    getConfigValue(prisma, 'DISCORD_VERIFIED_ROLE_ID'),
  ]);

  return {
    guildId,
    botToken,
    unverifiedRoleId: unverifiedRoleId || VERIFY_DEFAULTS.UNVERIFIED_ROLE_ID,
    verifiedRoleId: verifiedRoleId || VERIFY_DEFAULTS.VERIFIED_ROLE_ID,
  };
}

function discordHeaders(botToken) {
  return {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  };
}

async function fetchGuildRoles(guildId, botToken) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
    headers: discordHeaders(botToken),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch guild roles: ${res.status} ${body}`);
  }
  return res.json();
}

async function fetchGuildMember(guildId, discordId, botToken) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
    { headers: discordHeaders(botToken) }
  );
  if (res.status === 404) {
    return { ok: false, notFound: true };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `${res.status} ${body}` };
  }
  return { ok: true, member: await res.json() };
}

function buildRoleMap(roles) {
  return new Map(roles.map((r) => [r.id, r]));
}

function isTransferableRole(role, config) {
  if (!role || role.name === '@everyone') return false;
  if (role.managed) return false;
  if (role.id === config.unverifiedRoleId) return false;
  return true;
}

function dedupeRoles(roles) {
  const seen = new Set();
  const out = [];
  for (const role of roles) {
    if (!role || seen.has(role.id)) continue;
    seen.add(role.id);
    out.push(role);
  }
  return out;
}

function rolesFromMember(member, guildRoles, config) {
  if (!member?.roles?.length) return [];
  const byId = buildRoleMap(guildRoles);
  return dedupeRoles(
    member.roles
      .map((id) => byId.get(id))
      .filter((role) => isTransferableRole(role, config))
  );
}

function findRoleByPatterns(roles, patterns) {
  if (!patterns || patterns.length === 0) return null;
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  for (const role of sorted) {
    if (role.managed || role.name === '@everyone') continue;
    const nameLower = role.name.toLowerCase();
    for (const pattern of patterns) {
      if (nameLower.includes(pattern)) return role;
    }
  }
  return null;
}

function findPlanRole(roles, plan) {
  const patterns = PLAN_ROLE_PATTERNS[plan];
  if (!patterns) return null;

  const exact = roles.find(
    (r) => !r.managed && r.name !== '@everyone' && r.name.toLowerCase() === plan.toLowerCase()
  );
  if (exact) return exact;

  return findRoleByPatterns(roles, patterns);
}

function resolveStaffRole(roles, platformRole) {
  const patterns = STAFF_ROLE_PATTERNS[platformRole];
  if (!patterns || patterns.length === 0) return null;

  if (platformRole === 'MODERATOR') {
    const sorted = [...roles].sort((a, b) => b.position - a.position);
    for (const role of sorted) {
      if (role.managed || role.name === '@everyone') continue;
      const nameLower = role.name.toLowerCase();
      if (nameLower.includes('senior mod') || nameLower.includes('trial mod')) continue;
      if (nameLower.includes('moderator') || nameLower === 'mod') return role;
    }
    return null;
  }

  return findRoleByPatterns(roles, patterns);
}

async function resolveRoleFromConfig(prisma, guildRoles, configKey) {
  const roleId = await getConfigValue(prisma, configKey);
  if (!roleId) return null;
  return guildRoles.find((r) => r.id === roleId) || null;
}

async function rolesFromPlatform(prisma, guildRoles, user, config) {
  const found = [];
  const seen = new Set();

  const push = (role) => {
    if (!role || seen.has(role.id) || !isTransferableRole(role, config)) return;
    seen.add(role.id);
    found.push(role);
  };

  const planRole = findPlanRole(guildRoles, user.plan);
  push(planRole);

  const planConfigKey = CONFIG_ROLE_KEYS[user.plan];
  if (planConfigKey) {
    push(await resolveRoleFromConfig(prisma, guildRoles, planConfigKey));
  }

  const staffRole = resolveStaffRole(guildRoles, user.role);
  push(staffRole);

  const staffConfigKey = CONFIG_ROLE_KEYS[user.role];
  if (staffConfigKey) {
    push(await resolveRoleFromConfig(prisma, guildRoles, staffConfigKey));
  }

  return found;
}

function getAllPlanAndStaffRoles(roles) {
  const managed = [];
  const allPatterns = [
    ...Object.values(PLAN_ROLE_PATTERNS).flat(),
    ...Object.values(STAFF_ROLE_PATTERNS).flat().filter(Boolean),
  ];

  for (const role of roles) {
    if (role.managed || role.name === '@everyone') continue;
    const nameLower = role.name.toLowerCase();
    if (allPatterns.some((p) => nameLower.includes(p))) {
      managed.push(role);
    }
  }
  return managed;
}

async function addMemberRole(guildId, discordId, roleId, botToken) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: 'PUT', headers: discordHeaders(botToken) }
  );
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `${res.status} ${body}` };
  }
  return { ok: true };
}

async function removeMemberRole(guildId, discordId, roleId, botToken) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: 'DELETE', headers: discordHeaders(botToken) }
  );
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `${res.status} ${body}` };
  }
  return { ok: true };
}

async function swapVerificationRoles(guildId, discordId, config) {
  const { botToken, verifiedRoleId, unverifiedRoleId } = config;
  const results = { added: [], removed: [], warnings: [] };

  const addRes = await addMemberRole(guildId, discordId, verifiedRoleId, botToken);
  if (addRes.ok) results.added.push('Verified');
  else results.warnings.push(`Could not add verified role: ${addRes.error}`);

  const removeRes = await removeMemberRole(guildId, discordId, unverifiedRoleId, botToken);
  if (removeRes.ok) results.removed.push('Unverified');
  else if (removeRes.error && !removeRes.error.includes('404')) {
    results.warnings.push(`Could not remove unverified role: ${removeRes.error}`);
  }

  return results;
}

/**
 * Sync guild roles for old (strip) and new (apply) members after transfer.
 */
async function syncDiscordRolesAfterTransfer(
  prisma,
  { oldDiscordId, newDiscordId, transferredUser, wasVerified }
) {
  const config = await loadDiscordConfig(prisma);
  const result = {
    applied: [],
    removed: [],
    warnings: [],
    skipped: false,
    source: null,
  };

  if (!config.guildId || !config.botToken) {
    result.skipped = true;
    result.warnings.push('Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN — role sync skipped.');
    return result;
  }

  let guildRoles;
  try {
    guildRoles = await fetchGuildRoles(config.guildId, config.botToken);
  } catch (err) {
    result.warnings.push(err.message);
    return result;
  }

  const [oldMemberRes, newMemberRes] = await Promise.all([
    fetchGuildMember(config.guildId, oldDiscordId, config.botToken),
    fetchGuildMember(config.guildId, newDiscordId, config.botToken),
  ]);

  if (!newMemberRes.ok) {
    if (newMemberRes.notFound) {
      result.warnings.push(
        'New Discord account is not in the OpenSteam Discord server. The user must join the server before roles can be assigned.'
      );
    } else {
      result.warnings.push(`Could not fetch new guild member: ${newMemberRes.error}`);
    }
    return result;
  }

  let rolesToApply = [];

  if (oldMemberRes.ok) {
    rolesToApply = rolesFromMember(oldMemberRes.member, guildRoles, config);
    if (rolesToApply.length > 0) {
      result.source = 'copied_from_old_member';
    }
  } else if (oldMemberRes.notFound) {
    result.warnings.push(
      'Old Discord account is not in the server — using platform plan/role to resolve guild roles instead.'
    );
  } else if (oldMemberRes.error) {
    result.warnings.push(`Could not fetch old guild member: ${oldMemberRes.error}`);
  }

  if (rolesToApply.length === 0) {
    rolesToApply = await rolesFromPlatform(prisma, guildRoles, transferredUser, config);
    if (rolesToApply.length > 0) {
      result.source = result.source || 'platform_resolved';
    }
  }

  if (wasVerified) {
    const verifiedRole = guildRoles.find((r) => r.id === config.verifiedRoleId);
    if (verifiedRole && !rolesToApply.some((r) => r.id === verifiedRole.id)) {
      rolesToApply.push(verifiedRole);
    }
  }

  rolesToApply = dedupeRoles(rolesToApply);

  if (rolesToApply.length === 0) {
    result.warnings.push(
      `No Discord roles resolved for plan=${transferredUser.plan}, role=${transferredUser.role}. ` +
        'Copy failed because the old member has no transferable roles and name/config matching found none. ' +
        'Set DISCORD_PLAN_ROLE_* / DISCORD_STAFF_ROLE_* in SystemConfig or ensure guild role names contain the plan/role keyword.'
    );
    return result;
  }

  const planStaffRoles = getAllPlanAndStaffRoles(guildRoles);
  const stripFromNew = dedupeRoles([...planStaffRoles, ...rolesToApply]);

  for (const role of stripFromNew) {
    const removed = await removeMemberRole(config.guildId, newDiscordId, role.id, config.botToken);
    if (removed.ok) {
      result.removed.push(`${role.name} (cleared from new account)`);
    }
  }

  for (const role of rolesToApply) {
    const added = await addMemberRole(config.guildId, newDiscordId, role.id, config.botToken);
    if (added.ok) {
      result.applied.push(role.name);
    } else {
      result.warnings.push(
        `Could not add role "${role.name}" (${role.id}) to new account: ${added.error}. ` +
          'Check that the bot role is above this role in Server Settings → Roles.'
      );
    }
  }

  if (oldMemberRes.ok) {
    for (const role of rolesToApply) {
      const removed = await removeMemberRole(config.guildId, oldDiscordId, role.id, config.botToken);
      if (removed.ok) {
        result.removed.push(`${role.name} (removed from old account)`);
      }
    }
  }

  if (wasVerified) {
    const verifyResult = await swapVerificationRoles(config.guildId, newDiscordId, config);
    if (!result.applied.includes('Verified') && verifyResult.added.includes('Verified')) {
      result.applied.push('Verified');
    }
    result.removed.push(...verifyResult.removed);
    result.warnings.push(...verifyResult.warnings);
  }

  return result;
}

module.exports = { syncDiscordRolesAfterTransfer, loadDiscordConfig };
