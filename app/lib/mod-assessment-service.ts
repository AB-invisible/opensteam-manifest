import { prisma } from "@/app/lib/prisma";
import { parseQuestions, isMcq } from "@/app/lib/mod-assessment-types";
import type { LiveExamOverlapContext } from "@/app/lib/mod-assessment-exam-realtime";

/** Stored on `trial_tests.examKind` — Groq-assisted live-drawn moderator exam rows. */
export const LIVE_EXAM_KIND = "live";
/** Handbook MCQ cron/generate flows — distinct from {@link LIVE_EXAM_KIND}. */
export const LEGACY_EXAM_KIND = "legacy";

export async function liveExamOverview(userId: string) {
  const pendingReview = await prisma.trialTest.findFirst({
    where: { userId, examKind: LIVE_EXAM_KIND, status: "AWAITING_STAFF" },
    orderBy: { updatedAt: "desc" },
  });
  const passedRow = await prisma.trialTest.findFirst({
    where: {
      userId,
      examKind: LIVE_EXAM_KIND,
      status: { in: ["PASSED", "OVERRIDE_PASS"] },
    },
    orderBy: [{ gradedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const list = await prisma.trialTest.findMany({
    where: { userId, examKind: LIVE_EXAM_KIND },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      aiGrade: true,
      submittedAt: true,
    },
  });

  return {
    list,
    hasPassedLive: Boolean(passedRow),
    passedAttemptId: passedRow?.id ?? null,
    pendingReviewTestId: pendingReview?.id ?? null,
  };
}

/** Active fullscreen session — in progress or paused. */
export async function findActiveLiveTrialTest(userId: string) {
  return prisma.trialTest.findFirst({
    where: {
      userId,
      examKind: LIVE_EXAM_KIND,
      status: "ACTIVE",
      sessionState: { in: ["in_progress", "paused"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

function pushMcqStemsFromQuestions(
  json: unknown,
  into: string[],
  maxTotal: number
): void {
  for (const q of parseQuestions(json)) {
    if (into.length >= maxTotal) return;
    if (isMcq(q)) {
      const s = q.prompt.replace(/\s+/g, " ").trim().slice(0, 220);
      if (s.length > 12) into.push(s);
    }
  }
}

/**
 * Fill-pool usage from other users' in-flight exams; MCQ stems to avoid from those exams plus
 * this user's recent failed live attempts (limits reuse after someone sees an attempt / export).
 */
export async function liveExamOverlapContextExcludingUser(
  excludeUserId: string
): Promise<LiveExamOverlapContext> {
  const othersRows = await prisma.trialTest.findMany({
    where: {
      examKind: LIVE_EXAM_KIND,
      userId: { not: excludeUserId },
      status: { in: ["ACTIVE", "AWAITING_STAFF"] },
    },
    select: { questions: true },
  });

  const selfFailedRows = await prisma.trialTest.findMany({
    where: {
      userId: excludeUserId,
      examKind: LIVE_EXAM_KIND,
      status: { in: ["FAILED", "OVERRIDE_FAIL"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 6,
    select: { questions: true },
  });

  const fillBankUsage = new Map<string, number>();
  const avoidMcqPromptStems: string[] = [];

  for (const row of othersRows) {
    for (const q of parseQuestions(row.questions)) {
      if (isMcq(q)) {
        if (avoidMcqPromptStems.length >= 120) continue;
        const s = q.prompt.replace(/\s+/g, " ").trim().slice(0, 220);
        if (s.length > 12) avoidMcqPromptStems.push(s);
      } else {
        const k = q.bankKey?.trim();
        if (k) fillBankUsage.set(k, (fillBankUsage.get(k) ?? 0) + 1);
      }
    }
  }

  for (const row of selfFailedRows) {
    pushMcqStemsFromQuestions(row.questions, avoidMcqPromptStems, 120);
  }

  return { fillBankUsage, avoidMcqPromptStems };
}
