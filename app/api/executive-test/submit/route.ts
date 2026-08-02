import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { parseQuestions, isMcq } from "@/app/lib/mod-assessment-types";
import { buildAiGrade } from "@/app/lib/mod-assessment-grade";
import { notifyModStaffWide } from "@/app/lib/notify-mod-staff";
import { EXEC_CATEGORIES, execCategoryTotals } from "@/app/lib/exec-categories";
import { EXEC_OFFICER_EXAM_KIND, getPromoTier } from "@/app/lib/promo-tiers";
import { parseCategoryProgress } from "@/app/lib/exec-adaptive";
import { parseExecTimerState } from "@/app/lib/exec-timer";
import { finalizeTypingMetrics, sanitizePerQuestionTyping } from "@/app/lib/typing-metrics";
import { estimateEnglishLevel } from "@/app/lib/english-level";
import { buildExecCategoryReports } from "@/app/lib/exec-category-grade";

/**
 * Submit the Executive Officer exam for AI grading + estimated CEFR English level -> AWAITING_STAFF.
 * Callable manually or automatically when the 4-hour timer expires. Blanks are graded as 0.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const { dbUser } = auth.data;

    const body = await req.json().catch(() => ({}));
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    if (!attemptId) return NextResponse.json({ message: "attemptId required" }, { status: 400 });

    const testRow = await prisma.trialTest.findFirst({
      where: { id: attemptId, userId: dbUser.id, examKind: EXEC_OFFICER_EXAM_KIND },
      include: { user: true },
    });
    if (!testRow) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (testRow.sessionState !== "in_progress") {
      return NextResponse.json(
        { message: "Submit only from an active session.", sessionState: testRow.sessionState },
        { status: 409 },
      );
    }

    const questions = parseQuestions(testRow.questions);
    if (questions.length === 0) {
      return NextResponse.json({ message: "Exam snapshot missing — restart session." }, { status: 409 });
    }

    const timer = parseExecTimerState(testRow.timerState);
    const progress = parseCategoryProgress(timer.categoryProgress);
    const totals = execCategoryTotals();
    if (questions.length < totals.total) {
      return NextResponse.json(
        { message: "Complete all five categories before submitting.", questionsLoaded: questions.length, expected: totals.total },
        { status: 409 },
      );
    }
    if (progress && progress.completed.length < EXEC_CATEGORIES.length) {
      return NextResponse.json(
        { message: "Finish the current category block before submitting.", completed: progress.completed.length },
        { status: 409 },
      );
    }

    const ans =
      testRow.answers && typeof testRow.answers === "object" && testRow.answers !== null
        ? (testRow.answers as Record<string, string>)
        : {};

    // Normalize MCQ letters; leave blanks as-is (graded 0).
    for (const q of questions) {
      if (!isMcq(q)) continue;
      const v = (ans[q.id] ?? "").trim().toUpperCase();
      ans[q.id] = ["A", "B", "C", "D"].includes(v) ? v : "";
    }

    // Written answers are the language sample for the CEFR estimate.
    const writtenSamples = questions
      .filter((q) => !isMcq(q))
      .map((q) => (ans[q.id] ?? "").trim())
      .filter(Boolean);

    const typing = finalizeTypingMetrics(
      sanitizePerQuestionTyping(
        testRow.typingMetrics && typeof testRow.typingMetrics === "object"
          ? (testRow.typingMetrics as { perQuestion?: unknown }).perQuestion
          : undefined,
      ),
    );

    const [grade, english] = await Promise.all([
      buildAiGrade({ questions, answers: ans }),
      estimateEnglishLevel({ writtenSamples, typing }),
    ]);

    const categoryReports = await buildExecCategoryReports({
      questions,
      answers: ans,
      grade,
      english,
      typing,
    });

    const now = new Date();
    const pct = grade.totalMax > 0 ? Math.round((grade.totalEarned / grade.totalMax) * 1000) / 10 : 0;
    const fitRec = categoryReports.overallFit?.recommendation ?? "—";

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: {
        status: "AWAITING_STAFF",
        submittedAt: now,
        answers: ans,
        aiGrade: grade as object,
        typingMetrics: typing as object,
        englishLevel: english.level,
        englishAssessment: english as object,
        categoryReports: categoryReports as object,
        sessionState: null,
        pausedAt: null,
        lastPauseReason: null,
        score: grade.totalEarned,
        feedback:
          `AI draft: ${grade.totalEarned}/${grade.totalMax} (${pct}%). ` +
          `Estimated English: ${english.level} (${english.cambridgeExam}), ~${typing.overall.wpm} WPM. ` +
          `Fit: ${fitRec}. Awaiting staff review.`,
      },
    });

    const tier = getPromoTier(testRow.examKind);
    const disc = testRow.user?.discordId?.trim();

    await notifyModStaffWide({
      title: `${tier?.label ?? "Executive Officer exam"} submitted — needs manual confirmation`,
      lines: [
        `${testRow.user?.username ?? "Candidate"} (${testRow.user?.discordId ?? dbUser.id})`,
        `AI draft score: ${grade.totalEarned}/${grade.totalMax} (${pct}%)`,
        `Estimated English level: ${english.level} — ${english.cambridgeExam} (${Math.round(english.confidence * 100)}% conf, ~${typing.overall.wpm} WPM)`,
        `Executive fit: ${fitRec}`,
        `TrialTest \`${attemptId.slice(0, 10)}\` — approve, reject, or re-grade from dashboard.`,
      ],
      ...(disc ? { excludeDiscordUserIds: [disc] } : {}),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      awaitingManualReview: true,
      gradePreview: pct,
      englishLevel: english.level,
      cambridgeExam: english.cambridgeExam,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
