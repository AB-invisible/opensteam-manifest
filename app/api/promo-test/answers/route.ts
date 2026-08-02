import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { isMcq, parseQuestions } from "@/app/lib/mod-assessment-types";
import { PROMO_KINDS } from "@/app/lib/promo-exam-service";
import {
  parseTimerState,
  isSectionExpired,
  sectionForQuestion,
  type PromoSection,
} from "@/app/lib/promo-timer";

function normalizeStoredStrings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Autosave answers for the active section only. Writes targeting a section that is not current,
 * or whose timer has expired, are rejected — refreshing cannot extend a section's deadline.
 */
export async function PATCH(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const { dbUser } = auth.data;

    const body = await req.json();
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    const answers =
      typeof body.answers === "object" && body.answers !== null ? body.answers : null;

    if (!attemptId || !answers || Array.isArray(answers)) {
      return NextResponse.json({ message: "Invalid body" }, { status: 400 });
    }

    const test = await prisma.trialTest.findFirst({
      where: { id: attemptId, userId: dbUser.id, examKind: { in: PROMO_KINDS } },
    });
    if (!test) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (test.sessionState !== "in_progress") {
      return NextResponse.json(
        { message: "Answers are frozen while paused or submitted." },
        { status: 409 },
      );
    }

    const currentSection = (test.currentSection as PromoSection | null) ?? "mcq";
    const timer = parseTimerState(test.timerState);
    if (isSectionExpired(timer, currentSection)) {
      return NextResponse.json(
        { message: "This section's time has ended.", expired: true, section: currentSection },
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
      const q = byId.get(k);
      // Only accept answers belonging to the currently active section.
      if (!q || sectionForQuestion(q) !== currentSection) {
        skipped += 1;
        continue;
      }
      const t = v.trim();
      let next = t;
      if (mcqIds.has(k)) {
        const u = t.toUpperCase();
        next = /^[ABCD]$/.test(u) ? u : t;
      }
      incoming[k] = next;
    }

    const base = normalizeStoredStrings(test.answers);
    const merged = { ...base, ...incoming };

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: { answers: merged },
    });

    return NextResponse.json({ ok: true, savedKeys: Object.keys(incoming).length, skipped });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
