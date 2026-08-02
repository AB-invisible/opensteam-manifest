import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { isMcq, parseQuestions } from "@/app/lib/mod-assessment-types";
import { EXEC_OFFICER_EXAM_KIND } from "@/app/lib/promo-tiers";
import { parseExecTimerState, isExecExpired } from "@/app/lib/exec-timer";
import { sanitizePerQuestionTyping, mergePerQuestionTyping } from "@/app/lib/typing-metrics";

function normalizeStoredStrings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Autosave Executive Officer answers + cumulative typing analytics. Rejected once the single overall
 * timer has expired (refreshing cannot extend the deadline). Blanks remain allowed until submit.
 */
export async function PATCH(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const { dbUser } = auth.data;

    const body = await req.json();
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    const answers =
      typeof body.answers === "object" && body.answers !== null && !Array.isArray(body.answers)
        ? (body.answers as Record<string, unknown>)
        : null;
    const typingRaw =
      typeof body.typing === "object" && body.typing !== null ? body.typing : null;

    if (!attemptId || !answers) {
      return NextResponse.json({ message: "Invalid body" }, { status: 400 });
    }

    const test = await prisma.trialTest.findFirst({
      where: { id: attemptId, userId: dbUser.id, examKind: EXEC_OFFICER_EXAM_KIND },
    });
    if (!test) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (test.sessionState !== "in_progress") {
      return NextResponse.json(
        { message: "Answers are frozen while paused or submitted." },
        { status: 409 },
      );
    }

    const timer = parseExecTimerState(test.timerState);
    if (isExecExpired(timer)) {
      return NextResponse.json(
        { message: "The exam time has ended.", expired: true },
        { status: 409 },
      );
    }

    const questions = parseQuestions(test.questions);
    const byId = new Map(questions.map((q) => [q.id, q] as const));
    const mcqIds = new Set(questions.filter((q) => isMcq(q)).map((q) => q.id));

    const incoming: Record<string, string> = {};
    let skipped = 0;
    for (const [k, v] of Object.entries(answers)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      if (!byId.has(k)) {
        skipped += 1;
        continue;
      }
      const t = v.trim();
      if (mcqIds.has(k)) {
        const u = t.toUpperCase();
        incoming[k] = /^[ABCD]$/.test(u) ? u : t;
      } else {
        incoming[k] = v; // preserve written whitespace/formatting
      }
    }

    const base = normalizeStoredStrings(test.answers);
    const mergedAnswers = { ...base, ...incoming };

    let typingMetrics: object | undefined;
    if (typingRaw) {
      const incomingTyping = sanitizePerQuestionTyping(
        (typingRaw as { perQuestion?: unknown }).perQuestion ?? typingRaw,
      );
      const storedTyping =
        test.typingMetrics && typeof test.typingMetrics === "object"
          ? (test.typingMetrics as { perQuestion?: unknown }).perQuestion
          : undefined;
      typingMetrics = { perQuestion: mergePerQuestionTyping(storedTyping, incomingTyping) };
    }

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: {
        answers: mergedAnswers,
        ...(typingMetrics ? { typingMetrics } : {}),
      },
    });

    return NextResponse.json({ ok: true, savedKeys: Object.keys(incoming).length, skipped });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
