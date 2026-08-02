/**
 * Promotional (rank progression) test configuration.
 *
 * Moderator -> Senior Moderator -> Head Moderator. Each promo exam is a two-section
 * timed paper (ABCD multiple choice + written/typing) drawn live per attempt, graded by
 * AI then staff-confirmed (same pipeline as the trial live assessment), and on pass swaps
 * the candidate's Discord rank role for the next one.
 */
import { prisma } from "@/app/lib/prisma";
import { LIVE_EXAM_KIND } from "@/app/lib/mod-assessment-service";
import { resolveGuildBotToken } from "@/app/lib/discord-bot-credentials";
import { normalizeDiscordSnowflake } from "@/app/lib/discord-id";
import type { Role } from "@prisma/client";

/** Moderator — entry rank (already `DISCORD_FULL_MODERATOR_ROLE_ID`). */
export const DISCORD_MODERATOR_ROLE_ID = "1484966440376467687";
/** Senior Moderator. */
export const DISCORD_SENIOR_MODERATOR_ROLE_ID = "1521098101715374190";
/** Head Moderator. */
export const DISCORD_HEAD_MODERATOR_ROLE_ID = "1503424839422316574";
/** Executive Officer — rank above Head Moderator, granted by the Executive Officer exam. */
export const DISCORD_EXECUTIVE_OFFICER_ROLE_ID = "1477659165232201819";

/** Stored on `trial_tests.examKind` — Moderator -> Senior Moderator promotion exam. */
export const PROMO_SENIOR_EXAM_KIND = "promo_senior";
/** Stored on `trial_tests.examKind` — Senior Moderator -> Head Moderator promotion exam. */
export const PROMO_HEAD_EXAM_KIND = "promo_head";
/** Stored on `trial_tests.examKind` — Head Moderator -> Executive Officer exam (200q / 4h, single timer). */
export const EXEC_OFFICER_EXAM_KIND = "executive_officer";

export type PromoTier = {
  examKind: string;
  /** Short human label for embeds / PDFs / UI. */
  label: string;
  /** Discord role required to attempt (and removed on pass). */
  fromRoleId: string;
  /** Discord role granted on pass. */
  toRoleId: string;
  fromRoleName: string;
  toRoleName: string;
  /** ABCD multiple-choice section. */
  mcqCount: number;
  mcqMinutes: number;
  /** Written / typing section. */
  fillCount: number;
  fillMinutes: number;
  /** Minimum days the candidate must have held `fromRoleId` before unlocking. */
  tenureDays: number;
  /** Platform DB role granted on pass. */
  platformRole: Role;
  roleLevel: number;
  /**
   * Executive Officer only: one overall timed paper (all questions shown together) instead of
   * two per-section timers. When set, `examMinutes` is the total time budget.
   */
  singleTimer?: boolean;
  examMinutes?: number;
};

export const PROMO_TIERS: Record<string, PromoTier> = {
  [PROMO_SENIOR_EXAM_KIND]: {
    examKind: PROMO_SENIOR_EXAM_KIND,
    label: "Senior Moderator Promotion",
    fromRoleId: DISCORD_MODERATOR_ROLE_ID,
    toRoleId: DISCORD_SENIOR_MODERATOR_ROLE_ID,
    fromRoleName: "Moderator",
    toRoleName: "Senior Moderator",
    mcqCount: 35,
    mcqMinutes: 20,
    fillCount: 35,
    fillMinutes: 45,
    tenureDays: 7,
    platformRole: "SENIOR_MODERATOR",
    roleLevel: 75,
  },
  [PROMO_HEAD_EXAM_KIND]: {
    examKind: PROMO_HEAD_EXAM_KIND,
    label: "Head Moderator Promotion",
    fromRoleId: DISCORD_SENIOR_MODERATOR_ROLE_ID,
    toRoleId: DISCORD_HEAD_MODERATOR_ROLE_ID,
    fromRoleName: "Senior Moderator",
    toRoleName: "Head Moderator",
    mcqCount: 50,
    mcqMinutes: 30,
    fillCount: 50,
    fillMinutes: 60,
    tenureDays: 14,
    platformRole: "HEAD_MODERATOR",
    roleLevel: 90,
  },
  [EXEC_OFFICER_EXAM_KIND]: {
    examKind: EXEC_OFFICER_EXAM_KIND,
    label: "Executive Officer Exam",
    fromRoleId: DISCORD_HEAD_MODERATOR_ROLE_ID,
    toRoleId: DISCORD_EXECUTIVE_OFFICER_ROLE_ID,
    fromRoleName: "Head Moderator",
    toRoleName: "Executive Officer",
    // 200-question paper: 4 expertise categories (160 MCQ + 35 written) + 5 fit scenarios.
    mcqCount: 160,
    fillCount: 35,
    // Section minutes are unused for the single-timer Executive Officer paper (see examMinutes).
    mcqMinutes: 0,
    fillMinutes: 0,
    tenureDays: 21,
    platformRole: "EXECUTIVE_OFFICER",
    roleLevel: 95,
    singleTimer: true,
    examMinutes: 240, // 4 hours
  },
};

/** Promo tiers driven by the two-section promo-test routes (NOT the single-timer Executive Officer exam). */
export const PROMO_EXAM_KINDS = [PROMO_SENIOR_EXAM_KIND, PROMO_HEAD_EXAM_KIND] as const;

/** All live-drawn staff exams surfaced in the admin attempts table (trial + promo + executive). */
export const STAFF_REVIEWABLE_EXAM_KINDS = [
  LIVE_EXAM_KIND,
  ...PROMO_EXAM_KINDS,
  EXEC_OFFICER_EXAM_KIND,
] as const;

export function isStaffReviewableExamKind(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return (STAFF_REVIEWABLE_EXAM_KINDS as readonly string[]).includes(kind);
}

export function isPromoExamKind(kind: string | null | undefined): boolean {
  return kind === PROMO_SENIOR_EXAM_KIND || kind === PROMO_HEAD_EXAM_KIND;
}

export function isExecOfficerExamKind(kind: string | null | undefined): boolean {
  return kind === EXEC_OFFICER_EXAM_KIND;
}

export function getPromoTier(examKind: string | null | undefined): PromoTier | null {
  if (!examKind) return null;
  return PROMO_TIERS[examKind] ?? null;
}

type RoleOpResult = { ok: true } | { ok: false; error: string };

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
    headers: {
      Authorization: `Bot ${guildBot.token}`,
      "Content-Type": "application/json",
    },
  };
}

function normalizeMemberId(discordIdRaw: string): string | null {
  const discordId = normalizeDiscordSnowflake(discordIdRaw) || String(discordIdRaw || "").trim();
  return discordId || null;
}

async function addMemberRole(
  guildId: string,
  discordId: string,
  roleId: string,
  headers: Record<string, string>,
): Promise<RoleOpResult> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: "PUT", headers, signal: AbortSignal.timeout(10000) },
  );
  if (res.ok || res.status === 204) return { ok: true };
  const body = await res.text().catch(() => "");
  return { ok: false, error: `add role ${roleId}: ${res.status} ${body.slice(0, 200)}` };
}

async function removeMemberRole(
  guildId: string,
  discordId: string,
  roleId: string,
  headers: Record<string, string>,
): Promise<RoleOpResult> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: "DELETE", headers, signal: AbortSignal.timeout(10000) },
  );
  if (res.ok || res.status === 204) return { ok: true };
  const body = await res.text().catch(() => "");
  return { ok: false, error: `remove role ${roleId}: ${res.status} ${body.slice(0, 200)}` };
}

/** On promotion pass — remove the previous rank role and grant the next rank role. */
export async function promoteRankDiscordRoles(
  discordIdRaw: string,
  tier: PromoTier,
): Promise<RoleOpResult> {
  const discordId = normalizeMemberId(discordIdRaw);
  if (!discordId) return { ok: false, error: "Invalid Discord user id" };

  const ctx = await getGuildBotContext();
  if (!ctx) return { ok: false, error: "Missing guild ID or bot token" };

  const added = await addMemberRole(ctx.guildId, discordId, tier.toRoleId, ctx.headers);
  if (!added.ok) return added;

  // Best-effort removal of the prior rank — keeping it would be cosmetic only.
  await removeMemberRole(ctx.guildId, discordId, tier.fromRoleId, ctx.headers);

  return { ok: true };
}

export function logPromoRoleResult(stage: string, discordId: string, result: RoleOpResult): void {
  if (result.ok) return;
  console.warn(`[PromoRoles] ${stage} failed for ${discordId}:`, result.error);
}
