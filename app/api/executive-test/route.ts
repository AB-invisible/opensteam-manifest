import { NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { toPublicQuestions } from "@/app/lib/mod-assessment-public";
import { parseQuestions } from "@/app/lib/mod-assessment-types";
import { prisma } from "@/app/lib/prisma";
import { assertWebActivityFresh } from "@/app/lib/session-inactivity";
import { assertWebSessionNotRevoked } from "@/app/lib/web-session-revoke";
import {
  resolveExecEligibility,
  findActiveExecTrialTest,
  execPassedAttempt,
  execPendingReview,
  execTier,
} from "@/app/lib/exec-officer-service";
import { parseExecTimerState } from "@/app/lib/exec-timer";
import { EXEC_OFFICER_EXAM_KIND } from "@/app/lib/promo-tiers";
import { EXEC_CATEGORIES, execCategoryTotals } from "@/app/lib/exec-categories";

/** Current user's Executive Officer exam state: eligibility, active timed attempt, scrubbed questions, results. */
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

    const tier = execTier();
    const elig = await resolveExecEligibility(user);
    const active = await findActiveExecTrialTest(user.id);

    const passed = await execPassedAttempt(user.id, EXEC_OFFICER_EXAM_KIND);
    const pending = await execPendingReview(user.id, EXEC_OFFICER_EXAM_KIND);

    let resultStats:
      | { score: number | null; maxScore: number; passingScore: number; englishLevel: string | null }
      | null = null;
    const resultId = pending?.id ?? passed?.id ?? null;
    if (resultId) {
      const row = await prisma.trialTest.findUnique({
        where: { id: resultId },
        select: { score: true, maxScore: true, passingScore: true, englishLevel: true },
      });
      if (row) resultStats = row;
    }

    let attemptPayload: Record<string, unknown> | null = null;
    let publicQs: ReturnType<typeof toPublicQuestions> = [];
    if (active) {
      const answers =
        active.answers && typeof active.answers === "object" && active.answers !== null
          ? (active.answers as Record<string, string>)
          : {};
      const timer = parseExecTimerState(active.timerState);
      attemptPayload = {
        id: active.id,
        status: active.sessionState === "paused" ? "paused" : "in_progress",
        timerState: timer,
        currentCategory: active.currentSection ?? timer.categoryProgress?.currentCategoryId ?? "leadership",
        categoryProgress: timer.categoryProgress ?? null,
        answers,
      };
      publicQs = toPublicQuestions(parseQuestions(active.questions));
    }

    const totals = execCategoryTotals();
    const onTrack =
      elig.hasHeadModRole ||
      elig.hasExecRole ||
      Boolean(active) ||
      Boolean(passed) ||
      Boolean(pending);

    return NextResponse.json({
      eligible: elig.eligible && !active,
      eligibilityReason: elig.reason,
      rolesUnavailable: elig.rolesUnavailable,
      onTrack,
      hasHeadModRole: elig.hasHeadModRole,
      hasExecRole: elig.hasExecRole,
      categories: EXEC_CATEGORIES.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        mcqCount: c.mcqCount,
        writtenCount: c.writtenCount,
        difficulty: c.difficulty,
        isFit: c.isFit,
      })),
      tier: {
        examKind: tier.examKind,
        label: tier.label,
        fromRoleName: tier.fromRoleName,
        toRoleName: tier.toRoleName,
        mcqCount: totals.mcq,
        fillCount: totals.written,
        totalCount: totals.total,
        examMinutes: tier.examMinutes ?? 240,
        tenureDays: tier.tenureDays,
      },
      tenureDays: elig.tenureDays,
      requiredDays: elig.requiredDays,
      hasPassed: Boolean(passed),
      passedAttemptId: passed?.id ?? null,
      pendingReviewAttemptId: pending?.id ?? null,
      resultStats,
      attempt: attemptPayload,
      questions: publicQs,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
