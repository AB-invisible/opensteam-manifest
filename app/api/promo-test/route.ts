import { NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { toPublicQuestions } from "@/app/lib/mod-assessment-public";
import { parseQuestions } from "@/app/lib/mod-assessment-types";
import { prisma } from "@/app/lib/prisma";
import { assertWebActivityFresh } from "@/app/lib/session-inactivity";
import { assertWebSessionNotRevoked } from "@/app/lib/web-session-revoke";
import {
  resolvePromoEligibility,
  findActivePromoTrialTest,
  promoPassedAttempt,
  promoPendingReview,
  pickSurfacePromoTier,
  shouldBypassLowerPromoAttempt,
} from "@/app/lib/promo-exam-service";
import { parseTimerState } from "@/app/lib/promo-timer";
import { resolveExecEligibility } from "@/app/lib/exec-officer-service";

/** Current user's promotional-exam state: eligibility (rank + tenure), active timed attempt, scrubbed questions. */
export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const user = auth.data.dbUser;

    const revokeCheck = assertWebSessionNotRevoked(user);
    if (!revokeCheck.ok) {
      return NextResponse.json({ message: "Unauthorized", reason: revokeCheck.reason }, { status: 401 });
    }
    const activityCheck = assertWebActivityFresh(user);
    if (!activityCheck.ok) {
      return NextResponse.json({ message: "Unauthorized", reason: activityCheck.reason }, { status: 401 });
    }

    const execElig = await resolveExecEligibility(user);
    if (execElig.hasHeadModRole && !execElig.hasExecRole) {
      return NextResponse.json({
        eligible: false,
        eligibilityReason: null,
        rolesUnavailable: false,
        tier: null,
        tenureDays: null,
        requiredDays: null,
        hasPassed: false,
        passedAttemptId: null,
        pendingReviewAttemptId: null,
        pendingReviewStats: null,
        attempt: null,
        questions: [],
        supersededByExecutive: true,
      });
    }

    const elig = await resolvePromoEligibility(user);
    const active = await findActivePromoTrialTest(user.id);
    const bypassLower = shouldBypassLowerPromoAttempt(elig.tier, active?.examKind);
    const tier = pickSurfacePromoTier(elig.tier, bypassLower ? null : active?.examKind);
    const surfaceActive =
      active && tier && active.examKind === tier.examKind ? active : null;

    const passed = tier ? await promoPassedAttempt(user.id, tier.examKind) : null;
    const pending = tier ? await promoPendingReview(user.id, tier.examKind) : null;

    let pendingReviewStats: { score: number | null; maxScore: number; passingScore: number } | null = null;
    if (pending) {
      const row = await prisma.trialTest.findUnique({
        where: { id: pending.id },
        select: { score: true, maxScore: true, passingScore: true },
      });
      if (row) pendingReviewStats = row;
    }

    let attemptPayload: Record<string, unknown> | null = null;
    let publicQs: ReturnType<typeof toPublicQuestions> = [];
    if (surfaceActive) {
      const answers =
        surfaceActive.answers && typeof surfaceActive.answers === "object" && surfaceActive.answers !== null
          ? (surfaceActive.answers as Record<string, string>)
          : {};
      attemptPayload = {
        id: surfaceActive.id,
        status: surfaceActive.sessionState === "paused" ? "paused" : "in_progress",
        currentSection: surfaceActive.currentSection ?? "mcq",
        timerState: parseTimerState(surfaceActive.timerState),
        answers,
      };
      publicQs = toPublicQuestions(parseQuestions(surfaceActive.questions));
    }

    return NextResponse.json({
      eligible: elig.eligible && !surfaceActive && tier?.examKind === elig.tier?.examKind,
      eligibilityReason: elig.reason,
      rolesUnavailable: elig.rolesUnavailable,
      tier: tier
        ? {
            examKind: tier.examKind,
            label: tier.label,
            fromRoleName: tier.fromRoleName,
            toRoleName: tier.toRoleName,
            mcqCount: tier.mcqCount,
            fillCount: tier.fillCount,
            mcqMinutes: tier.mcqMinutes,
            fillMinutes: tier.fillMinutes,
            tenureDays: tier.tenureDays,
          }
        : null,
      tenureDays: elig.tenureDays,
      requiredDays: elig.requiredDays,
      hasPassed: Boolean(passed),
      passedAttemptId: passed?.id ?? null,
      pendingReviewAttemptId: pending?.id ?? null,
      pendingReviewStats,
      attempt: attemptPayload,
      questions: publicQs,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
