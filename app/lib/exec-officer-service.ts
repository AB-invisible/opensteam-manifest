/**
 * Service helpers for the Executive Officer exam (Head Moderator -> Executive Officer).
 *
 * Stored on `trial_tests` with `examKind = executive_officer`. Unlike the two-section promo exams,
 * this is a single 200-question paper with one 4-hour timer, keystroke/typing analytics, and an
 * estimated CEFR / Cambridge English level. Eligibility mirrors the promo tenure/rank gating but is
 * fixed to the Head Moderator -> Executive Officer step.
 */
import { prisma } from "@/app/lib/prisma";
import {
  EXEC_OFFICER_EXAM_KIND,
  DISCORD_HEAD_MODERATOR_ROLE_ID,
  DISCORD_EXECUTIVE_OFFICER_ROLE_ID,
  getPromoTier,
  type PromoTier,
} from "@/app/lib/promo-tiers";
import { fetchGuildMemberRoleIds, getRoleTenureDays } from "@/app/lib/discord-role-tenure";
import { promoPassedAttempt, promoPendingReview } from "@/app/lib/promo-exam-service";

export const EXEC_KINDS = [EXEC_OFFICER_EXAM_KIND] as const;

/** The single Executive Officer tier config (guaranteed present). */
export function execTier(): PromoTier {
  const tier = getPromoTier(EXEC_OFFICER_EXAM_KIND);
  if (!tier) throw new Error("Executive Officer tier is not configured.");
  return tier;
}

/** Any active (in progress / paused) Executive Officer session for the user. */
export async function findActiveExecTrialTest(userId: string) {
  return prisma.trialTest.findFirst({
    where: {
      userId,
      examKind: EXEC_OFFICER_EXAM_KIND,
      status: "ACTIVE",
      sessionState: { in: ["in_progress", "paused"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export { promoPassedAttempt as execPassedAttempt, promoPendingReview as execPendingReview };

export type ExecEligibility = {
  eligible: boolean;
  reason: string | null;
  tier: PromoTier;
  tenureDays: number | null;
  requiredDays: number;
  rolesUnavailable: boolean;
  /** Discord Head Moderator role (or platform HEAD_MODERATOR when roles cannot be read). */
  hasHeadModRole: boolean;
  /** Discord Executive Officer role (or platform EXECUTIVE_OFFICER). */
  hasExecRole: boolean;
};

type EligibilityUser = {
  id: string;
  discordId: string;
  role?: string | null;
  discordVerifiedAt?: Date | null;
  createdAt?: Date | null;
  discordProfileSnapshot?: unknown;
};

/**
 * Head Moderators who have held the rank long enough may attempt the Executive Officer exam.
 * A prior pass or a pending review blocks re-taking. Executive Officers (already promoted) are done.
 */
export async function resolveExecEligibility(user: EligibilityUser): Promise<ExecEligibility> {
  const tier = execTier();
  const platformHeadMod = user.role === "HEAD_MODERATOR";
  const platformExec = user.role === "EXECUTIVE_OFFICER";

  const base: ExecEligibility = {
    eligible: false,
    reason: null,
    tier,
    tenureDays: null,
    requiredDays: tier.tenureDays,
    rolesUnavailable: false,
    hasHeadModRole: platformHeadMod,
    hasExecRole: platformExec,
  };

  if (!user.discordId) {
    return { ...base, reason: "Your account is not linked to Discord." };
  }

  const roleIds = await fetchGuildMemberRoleIds(user.discordId);
  if (roleIds == null) {
    return {
      ...base,
      rolesUnavailable: true,
      hasHeadModRole: platformHeadMod,
      hasExecRole: platformExec,
      reason: platformHeadMod
        ? null
        : "Could not read your Discord roles right now. Try again shortly.",
    };
  }

  const hasHeadModRole = roleIds.includes(DISCORD_HEAD_MODERATOR_ROLE_ID) || platformHeadMod;
  const hasExecRole = roleIds.includes(DISCORD_EXECUTIVE_OFFICER_ROLE_ID) || platformExec;
  const withRoles = { ...base, hasHeadModRole, hasExecRole };

  if (hasExecRole) {
    return { ...withRoles, reason: "You already hold the Executive Officer rank." };
  }
  if (!hasHeadModRole) {
    return { ...withRoles, reason: "You need the Head Moderator role in Discord to attempt the Executive Officer exam." };
  }

  const passed = await promoPassedAttempt(user.id, tier.examKind);
  if (passed) {
    return { ...withRoles, reason: "You have already passed the Executive Officer exam." };
  }

  const pending = await promoPendingReview(user.id, tier.examKind);
  if (pending) {
    return { ...withRoles, reason: "Your last submission is awaiting staff review." };
  }

  const tenure = await getRoleTenureDays({
    discordId: user.discordId,
    roleId: tier.fromRoleId,
    currentRoleIds: roleIds,
    user,
  });

  const tenureDays = tenure.days;
  if (tenureDays == null || tenureDays < tier.tenureDays) {
    const have = tenureDays == null ? 0 : Math.floor(tenureDays);
    return {
      ...withRoles,
      tenureDays,
      reason: `You need ${tier.tenureDays} days as ${tier.fromRoleName} to attempt the ${tier.label}. You currently have ${have}.`,
    };
  }

  return {
    eligible: true,
    reason: null,
    tier,
    tenureDays,
    requiredDays: tier.tenureDays,
    rolesUnavailable: false,
    hasHeadModRole,
    hasExecRole,
  };
}
