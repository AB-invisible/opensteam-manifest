import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { LIVE_EXAM_KIND } from "@/app/lib/mod-assessment-service";
import { isMcq, parseQuestions } from "@/app/lib/mod-assessment-types";

function normalizeStoredStrings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return out;
}

/** Autosave answers while fullscreen session is writable. Incoming keys merge onto existing snapshot so partial payloads never wipe unrelated fields. MCQ letters normalized when we can match ids to questions. */
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
      where: { id: attemptId, userId: dbUser.id, examKind: LIVE_EXAM_KIND },
    });
    if (!test) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (test.sessionState !== "in_progress") {
      return NextResponse.json(
        { message: "Answers are frozen while paused or submitted." },
        { status: 409 }
      );
    }

    const questions = parseQuestions(test.questions);
    const mcqIds = new Set(questions.filter((q) => isMcq(q)).map((q) => q.id));

    const incoming: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      const t = v.trim();
      let next = t;
      if (mcqIds.has(k)) {
        const u = t.toUpperCase();
        next = /^[ABCD]$/.test(u) ? u : t;
      }
      incoming[k] = next;
    }

    const base = normalizeStoredStrings(test.answers);
    /** Latest client payload wins key-by-key — client always merges full local state before send. */
    const merged = { ...base, ...incoming };

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: { answers: merged },
    });

    return NextResponse.json({ ok: true, savedKeys: Object.keys(incoming).length });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
