import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { parseQuestions, isMcq } from "@/app/lib/mod-assessment-types";
import { buildAiGrade } from "@/app/lib/mod-assessment-grade";
import { notifyModStaffWide } from "@/app/lib/notify-mod-staff";
import { LIVE_EXAM_KIND } from "@/app/lib/mod-assessment-service";

/** Submit for AI grading → AWAITING_STAFF until admins approve / reject / re-grade. */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const { dbUser } = auth.data;

    const body = await req.json();
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";

    if (!attemptId) {
      return NextResponse.json({ message: "attemptId required" }, { status: 400 });
    }

    const testRow = await prisma.trialTest.findFirst({
      where: { id: attemptId, userId: dbUser.id, examKind: LIVE_EXAM_KIND },
      include: { user: true },
    });

    if (!testRow) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (testRow.sessionState !== "in_progress") {
      return NextResponse.json(
        { message: "Submit only from an active session.", sessionState: testRow.sessionState },
        { status: 409 }
      );
    }

    const questions = parseQuestions(testRow.questions);
    if (questions.length === 0) {
      return NextResponse.json({ message: "Exam snapshot missing — restart session." }, { status: 409 });
    }
    const ans =
      testRow.answers && typeof testRow.answers === "object" && testRow.answers !== null
        ? (testRow.answers as Record<string, string>)
        : {};

    const missing: string[] = [];
    for (const q of questions) {
      const v = (ans[q.id] ?? "").trim();
      if (!v) missing.push(q.id);
    }
    if (missing.length > 0) {
      return NextResponse.json({ message: "Answer every question.", missing }, { status: 400 });
    }

    for (const q of questions) {
      if (!isMcq(q)) continue;
      const v = (ans[q.id] ?? "").trim().toUpperCase();
      if (!["A", "B", "C", "D"].includes(v)) {
        return NextResponse.json({ message: `Invalid MCQ response for ${q.id}` }, { status: 400 });
      }
      ans[q.id] = v;
    }

    const grade = await buildAiGrade({ questions, answers: ans });

    const now = new Date();
    const pct =
      grade.totalMax > 0 ? Math.round((grade.totalEarned / grade.totalMax) * 1000) / 10 : 0;

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: {
        status: "AWAITING_STAFF",
        submittedAt: now,
        answers: ans,
        aiGrade: grade as object,
        sessionState: null,
        pausedAt: null,
        lastPauseReason: null,
        score: grade.totalEarned,
        feedback: `AI draft: ${grade.totalEarned}/${grade.totalMax} (${pct}%). Awaiting staff review.`,
      },
    });

    const disc = testRow.user?.discordId?.trim();

    await notifyModStaffWide({
      title: "Assessment submitted — needs manual confirmation",
      lines: [
        `${testRow.user?.username ?? "Candidate"} (${testRow.user?.discordId ?? dbUser.id})`,
        `AI draft score: ${grade.totalEarned}/${grade.totalMax} (${pct}%)`,
        `TrialTest \`${attemptId.slice(0, 10)}\` — approve, reject, or re-grade from dashboard.`,
      ],
      ...(disc ? { excludeDiscordUserIds: [disc] } : {}),
    }).catch(() => {});

    return NextResponse.json({ ok: true, awaitingManualReview: true, gradePreview: pct });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
