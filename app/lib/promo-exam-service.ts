/**
 * Service helpers for promotional rank exams (stored on `trial_tests` with examKind
 * promo_senior / promo_head). Mirrors mod-assessment-service.ts but adds rank/tenure eligibility.
 */
import { prisma } from "@/app/lib/prisma";
import { parseQuestions, isMcq } from "@/app/lib/mod-assessment-types";
import {
  PROMO_EXAM_KINDS,
  PROMO_SENIOR_EXAM_KIND,
  PROMO_HEAD_EXAM_KIND,
  PROMO_TIERS,
  DISCORD_MODERATOR_ROLE_ID,
  DISCORD_SENIOR_MODERATOR_ROLE_ID,
  DISCORD_HEAD_MODERATOR_ROLE_ID,
  getPromoTier,
  type PromoTier,
} from "@/app/lib/promo-tiers";
import { fetchGuildMemberRoleIds, getRoleTenureDays } from "@/app/lib/discord-role-tenure";

const PROMO_KINDS = [...PROMO_EXAM_KINDS];

/** Passed (final or staff-overridden) attempt for a specific promo tier. */
export async function promoPassedAttempt(userId: string, examKind: string) {
  return prisma.trialTest.findFirst({
    where: { userId, examKind, status: { in: ["PASSED", "OVERRIDE_PASS"] } },
    orderBy: [{ gradedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
}

/** AWAITING_STAFF attempt for a specific promo tier. */
export async function promoPendingReview(userId: string, examKind: string) {
  return prisma.trialTest.findFirst({
    where: { userId, examKind, status: "AWAITING_STAFF" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
}

/** Any active (in progress / paused) promo session for the user, regardless of tier. */
export async function findActivePromoTrialTest(userId: string) {
  return prisma.trialTest.findFirst({
    where: {
      userId,
      examKind: { in: PROMO_KINDS },
      status: "ACTIVE",
      sessionState: { in: ["in_progress", "paused"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export type PromoEligibility = {
  eligible: boolean;
  reason: string | null;
  tier: PromoTier | null;
  /** Days held on the prerequisite role (null when unknown / not held). */
  tenureDays: number | null;
  requiredDays: number | null;
  /** True when staff/system couldn't read Discord roles (transient). */
  rolesUnavailable: boolean;
};

type EligibilityUser = {
  id: string;
  discordId: string;
  discordVerifiedAt?: Date | null;
  createdAt?: Date | null;
  discordProfileSnapshot?: unknown;
};

/**
 * Determines the candidate's next promotion based on their CURRENT Discord rank role plus the
 * minimum tenure required for that step. A pending review or prior pass blocks re-taking.
 */
export async function resolvePromoEligibility(
  user: EligibilityUser,
): Promise<PromoEligibility> {
  const base: PromoEligibility = {
    eligible: false,
    reason: null,
    tier: null,
    tenureDays: null,
    requiredDays: null,
    rolesUnavailable: false,
  };

  if (!user.discordId) {
    return { ...base, reason: "Your account is not linked to Discord." };
  }

  const roleIds = await fetchGuildMemberRoleIds(user.discordId);
  if (roleIds == null) {
    return { ...base, rolesUnavailable: true, reason: "Could not read your Discord roles right now. Try again shortly." };
  }

  const hasModerator = roleIds.includes(DISCORD_MODERATOR_ROLE_ID);
  const hasSenior = roleIds.includes(DISCORD_SENIOR_MODERATOR_ROLE_ID);
  const hasHead = roleIds.includes(DISCORD_HEAD_MODERATOR_ROLE_ID);

  let tier: PromoTier | null = null;
  if (hasHead) {
    return { ...base, reason: "You already hold the highest tracked rank (Head Moderator)." };
  } else if (hasSenior) {
    tier = PROMO_TIERS[PROMO_HEAD_EXAM_KIND];
  } else if (hasModerator) {
    tier = PROMO_TIERS[PROMO_SENIOR_EXAM_KIND];
  } else {
    return { ...base, reason: "You need the Moderator role in Discord to start a promotion exam." };
  }

  const passed = await promoPassedAttempt(user.id, tier.examKind);
  if (passed) {
    return { ...base, tier, reason: `You have already passed the ${tier.label}.` };
  }

  const pending = await promoPendingReview(user.id, tier.examKind);
  if (pending) {
    return { ...base, tier, reason: "Your last submission is awaiting staff review." };
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
      ...base,
      tier,
      tenureDays,
      requiredDays: tier.tenureDays,
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
  };
}

export type PromoExamOverlapContext = {
  avoidMcqPromptStems: string[];
  avoidFillPromptStems: string[];
};

/** MCQ + fill prompt stems to avoid from concurrent promo exams of the same tier + this user's recent attempts. */
export async function promoExamOverlapContext(
  excludeUserId: string,
  examKind: string,
): Promise<PromoExamOverlapContext> {
  const rows = await prisma.trialTest.findMany({
    where: {
      examKind,
      OR: [
        { userId: { not: excludeUserId }, status: { in: ["ACTIVE", "AWAITING_STAFF"] } },
        { userId: excludeUserId, status: { in: ["FAILED", "OVERRIDE_FAIL"] } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 24,
    select: { questions: true },
  });

  const avoidMcqPromptStems: string[] = [];
  const avoidFillPromptStems: string[] = [];

  for (const row of rows) {
    for (const q of parseQuestions(row.questions)) {
      const s = q.prompt.replace(/\s+/g, " ").trim().slice(0, 220);
      if (s.length <= 12) continue;
      if (isMcq(q)) {
        if (avoidMcqPromptStems.length < 160) avoidMcqPromptStems.push(s);
      } else if (avoidFillPromptStems.length < 160) {
        avoidFillPromptStems.push(s);
      }
    }
  }

  return { avoidMcqPromptStems, avoidFillPromptStems };
}

export { getPromoTier, PROMO_KINDS };

/** Prefer the highest applicable promo tier (eligibility wins over a stale lower in-flight attempt). */
export function pickSurfacePromoTier(
  eligTier: PromoTier | null,
  activeExamKind: string | null | undefined,
): PromoTier | null {
  const activeTier = activeExamKind ? getPromoTier(activeExamKind) : null;
  if (!eligTier && !activeTier) return null;
  if (!eligTier) return activeTier;
  if (!activeTier) return eligTier;
  return eligTier.roleLevel >= activeTier.roleLevel ? eligTier : activeTier;
}

/** True when Discord rank / eligibility advanced past an older promo attempt still marked ACTIVE. */
export function shouldBypassLowerPromoAttempt(
  eligTier: PromoTier | null,
  activeExamKind: string | null | undefined,
): boolean {
  if (!eligTier || !activeExamKind) return false;
  const activeTier = getPromoTier(activeExamKind);
  if (!activeTier) return false;
  return eligTier.roleLevel > activeTier.roleLevel;
}
