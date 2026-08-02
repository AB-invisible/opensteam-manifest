/**
 * Discord role tenure (time-on-role) helpers used to gate promotional tests.
 *
 * The guild bot keeps `discord_role_tenure` rows fresh on role changes. When a row is missing
 * (member already held the role before tracking began) we seed `since` conservatively from the
 * verification snapshot (verifiedAt) or, failing that, "now".
 */
import { prisma } from "@/app/lib/prisma";
import { resolveGuildBotToken } from "@/app/lib/discord-bot-credentials";
import { normalizeDiscordSnowflake } from "@/app/lib/discord-id";
import {
  DISCORD_MODERATOR_ROLE_ID,
  DISCORD_SENIOR_MODERATOR_ROLE_ID,
  DISCORD_HEAD_MODERATOR_ROLE_ID,
} from "@/app/lib/promo-tiers";

/** Roles whose tenure we care about for promotions. */
export const TRACKED_TENURE_ROLE_IDS = [
  DISCORD_MODERATOR_ROLE_ID,
  DISCORD_SENIOR_MODERATOR_ROLE_ID,
  DISCORD_HEAD_MODERATOR_ROLE_ID,
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

async function getGuildBotContext(): Promise<{
  guildId: string;
  headers: Record<string, string>;
} | null> {
  const [guildConfig, guildBot] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { key: "DISCORD_GUILD_ID" } }),
    resolveGuildBotToken(),
  ]);
  const guildId = guildConfig?.value?.trim();
  if (!guildId || !guildBot.token) return null;
  return {
    guildId,
    headers: { Authorization: `Bot ${guildBot.token}` },
  };
}

/** Live guild role IDs for a member, or null if the member/bot/guild can't be resolved. */
export async function fetchGuildMemberRoleIds(discordIdRaw: string): Promise<string[] | null> {
  const discordId = normalizeDiscordSnowflake(discordIdRaw) || String(discordIdRaw || "").trim();
  if (!discordId) return null;

  const ctx = await getGuildBotContext();
  if (!ctx) return null;

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${ctx.guildId}/members/${discordId}`,
      { headers: ctx.headers, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { roles?: unknown };
    if (!Array.isArray(body.roles)) return [];
    return body.roles.filter((r): r is string => typeof r === "string");
  } catch {
    return null;
  }
}

type UserSnapshotShape = {
  discordVerifiedAt?: Date | null;
  createdAt?: Date | null;
  discordProfileSnapshot?: unknown;
};

function snapshotHasRole(snapshot: unknown, roleId: string): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const gm = (snapshot as { guildMember?: { roles?: unknown } }).guildMember;
  const roles = gm?.roles;
  return Array.isArray(roles) && roles.some((r) => r === roleId);
}

/**
 * Returns (and persists if missing) the continuous-hold start for a tracked role.
 * Seeds from the verification snapshot when the member already held the role before tracking.
 */
export async function ensureTenureSince(
  discordId: string,
  roleId: string,
  user?: UserSnapshotShape | null,
): Promise<Date> {
  const existing = await prisma.discordRoleTenure.findUnique({
    where: { discordId_roleId: { discordId, roleId } },
  });
  if (existing && !existing.removedAt) return existing.since;

  const u =
    user ??
    (await prisma.user.findUnique({
      where: { discordId },
      select: { discordVerifiedAt: true, createdAt: true, discordProfileSnapshot: true },
    }));

  const seededFromSnapshot = u ? snapshotHasRole(u.discordProfileSnapshot, roleId) : false;
  const since = seededFromSnapshot
    ? u?.discordVerifiedAt ?? u?.createdAt ?? new Date()
    : new Date();
  const source = seededFromSnapshot ? "snapshot" : "now";

  await prisma.discordRoleTenure.upsert({
    where: { discordId_roleId: { discordId, roleId } },
    update: { since, removedAt: null, source },
    create: { discordId, roleId, since, source },
  });

  return since;
}

export type RoleTenure = {
  hasRole: boolean;
  /** Whole + fractional days held, or null when the member does not currently hold the role. */
  days: number | null;
  since: Date | null;
};

/**
 * Days the member has continuously held `roleId`. `currentRoleIds` may be passed to avoid an
 * extra Discord fetch; otherwise live roles are fetched. Returns hasRole=false when not held.
 */
export async function getRoleTenureDays(args: {
  discordId: string;
  roleId: string;
  currentRoleIds?: string[] | null;
  user?: UserSnapshotShape | null;
}): Promise<RoleTenure> {
  const discordId =
    normalizeDiscordSnowflake(args.discordId) || String(args.discordId || "").trim();
  if (!discordId) return { hasRole: false, days: null, since: null };

  let roleIds = args.currentRoleIds ?? null;
  if (roleIds == null) {
    roleIds = await fetchGuildMemberRoleIds(discordId);
  }
  // null = couldn't resolve roles; treat as not-holding to avoid false positives.
  if (!roleIds || !roleIds.includes(args.roleId)) {
    return { hasRole: false, days: null, since: null };
  }

  const since = await ensureTenureSince(discordId, args.roleId, args.user);
  const days = (Date.now() - since.getTime()) / DAY_MS;
  return { hasRole: true, days, since };
}

/**
 * Manually force how many days a member has held a role (staff override). Sets `since` to
 * now - days so eligibility checks treat the member as having that much tenure.
 */
export async function setRoleTenureDays(
  discordIdRaw: string,
  roleId: string,
  days: number,
  source = "manual",
): Promise<Date> {
  const discordId =
    normalizeDiscordSnowflake(discordIdRaw) || String(discordIdRaw || "").trim();
  const clamped = Math.max(0, Math.min(days, 3650));
  const since = new Date(Date.now() - clamped * DAY_MS);
  await prisma.discordRoleTenure.upsert({
    where: { discordId_roleId: { discordId, roleId } },
    update: { since, removedAt: null, source },
    create: { discordId, roleId, since, source },
  });
  return since;
}

/** Reset tenure for a role to "now" (used after a promotion grants the next rank). */
export async function resetRoleTenure(discordId: string, roleId: string): Promise<void> {
  const id = normalizeDiscordSnowflake(discordId) || String(discordId || "").trim();
  if (!id) return;
  await prisma.discordRoleTenure
    .upsert({
      where: { discordId_roleId: { discordId: id, roleId } },
      update: { since: new Date(), removedAt: null, source: "bot" },
      create: { discordId: id, roleId, since: new Date(), source: "bot" },
    })
    .catch(() => {});
}
