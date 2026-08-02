import { NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { toPublicQuestions } from "@/app/lib/mod-assessment-public";
import { parseQuestions } from "@/app/lib/mod-assessment-types";
import { liveExamOverview, findActiveLiveTrialTest } from "@/app/lib/mod-assessment-service";
import { prisma } from "@/app/lib/prisma";
import { assertWebActivityFresh } from "@/app/lib/session-inactivity";
import { assertWebSessionNotRevoked } from "@/app/lib/web-session-revoke";

const LIVE_TITLE = "Moderator assessment (live‑drawn)";

/** Current user mod-assessment state (eligibility + active TrialTest snapshot + scrubbed questions). */
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

    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: { modTestReadyAt: true },
    });

    const overview = await liveExamOverview(user.id);
    const active = await findActiveLiveTrialTest(user.id);

    let pendingReviewStats: {
      score: number | null;
      maxScore: number;
      passingScore: number;
    } | null = null;
    if (overview.pendingReviewTestId) {
      const row = await prisma.trialTest.findUnique({
        where: { id: overview.pendingReviewTestId },
        select: { score: true, maxScore: true, passingScore: true },
      });
      if (row) pendingReviewStats = row;
    }

    const qsRaw = active?.questions;
    const qsFromTest =
      qsRaw && typeof qsRaw === "object" ? parseQuestions(qsRaw) : [];

    const publicQs = toPublicQuestions(qsFromTest);

    const eligible = Boolean(
      full?.modTestReadyAt && !overview.hasPassedLive && !overview.pendingReviewTestId
    );
    let reason = "";
    if (!full?.modTestReadyAt) {
      reason =
        "Your moderator assessment has not been unlocked yet — wait until staff announces it.";
    } else if (overview.hasPassedLive) {
      reason = "You have already completed and passed this assessment.";
    } else if (overview.pendingReviewTestId) {
      reason = "Your last submission is waiting for manual staff review.";
    }

    let attemptPayload: Record<string, unknown> | null = null;
    if (active) {
      const ans =
        active.answers && typeof active.answers === "object" && active.answers !== null
          ? (active.answers as Record<string, string>)
          : {};
      const sess = active.sessionState;
      attemptPayload = {
        id: active.id,
        status:
          sess === "paused" ? "paused" : sess === "in_progress" ? "in_progress" : "in_progress",
        answers: ans,
      };
    }

    return NextResponse.json({
      eligible,
      eligibilityReason: reason || null,
      hasPassedLive: overview.hasPassedLive,
      passedAttemptId: overview.passedAttemptId,
      assessment: {
        id: active?.id ?? "pending",
        title: LIVE_TITLE,
        questions: publicQs,
      },
      attempt: attemptPayload,
      pendingManualReviewAttemptId: overview.pendingReviewTestId,
      pendingReviewStats,
      overview: overview.list,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
