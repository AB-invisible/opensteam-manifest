import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage, isPrivilegedStaff } from "@/app/lib/auth-helpers";
import { STAFF_REVIEWABLE_EXAM_KINDS } from "@/app/lib/promo-tiers";
import { resolveExamAnswerKey } from "@/app/lib/mod-assessment-answer-key";
import { isMcq, parseQuestions } from "@/app/lib/mod-assessment-types";
import { normalizeTrialAnswersJson } from "@/app/lib/mod-assessment-normalize-answers";
import type { AiGradePayload, QuestionGradeDetail } from "@/app/lib/mod-assessment-grade";

function parseStoredAiGrade(raw: unknown): {
  byId: Record<string, Pick<QuestionGradeDetail, "earned" | "max" | "rationale" | "source">>;
  summary: Pick<AiGradePayload, "totalEarned" | "totalMax" | "aiModel" | "gradedAt"> | null;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { byId: {}, summary: null };
  }
  const g = raw as Partial<AiGradePayload>;
  const byId: Record<string, Pick<QuestionGradeDetail, "earned" | "max" | "rationale" | "source">> =
    {};
  if (g.byQuestionId && typeof g.byQuestionId === "object" && !Array.isArray(g.byQuestionId)) {
    for (const [qid, v] of Object.entries(g.byQuestionId)) {
      if (!v || typeof v !== "object") continue;
      const d = v as Partial<QuestionGradeDetail>;
      if (
        typeof d.earned === "number" &&
        typeof d.max === "number" &&
        (d.source === "mcq" || d.source === "ai")
      ) {
        byId[qid] = {
          earned: d.earned,
          max: d.max,
          rationale: typeof d.rationale === "string" ? d.rationale : undefined,
          source: d.source,
        };
      }
    }
  }
  const summary =
    typeof g.totalEarned === "number" && typeof g.totalMax === "number"
      ? {
          totalEarned: g.totalEarned,
          totalMax: g.totalMax,
          aiModel: typeof g.aiModel === "string" ? g.aiModel : undefined,
          gradedAt: typeof g.gradedAt === "string" ? g.gradedAt : undefined,
        }
      : null;
  return { byId, summary };
}

/**
 * Staff JSON: questions + candidate responses (if any) + answer key / rubrics for grading.
 * Available for ACTIVE (in progress), AWAITING_STAFF, and terminal statuses — use for preview before submit.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!isPrivilegedStaff(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const tt = await prisma.trialTest.findFirst({
      where: { id, examKind: { in: [...STAFF_REVIEWABLE_EXAM_KINDS] } },
      include: { user: { select: { username: true } } },
    });
    if (!tt) return NextResponse.json({ message: "Not found" }, { status: 404 });

    const questions = parseQuestions(tt.questions);
    const answers = normalizeTrialAnswersJson(tt.answers);
    const answerKey = resolveExamAnswerKey(tt.examAnswerKey, questions);
    const keyById = new Map(answerKey.items.map((i) => [i.id, i] as const));

    const { byId: aiByQuestionId, summary: aiSummary } = parseStoredAiGrade(tt.aiGrade);

    const items = questions.map((q, idx) => {
      const letter = answers[q.id] ?? "";
      const ki = keyById.get(q.id);
      const aiDraft = aiByQuestionId[q.id] ?? null;
      if (isMcq(q)) {
        return {
          index: idx + 1,
          kind: "mcq" as const,
          id: q.id,
          prompt: q.prompt,
          choices: q.choices,
          answerLetter: /^[abcd]$/i.test(letter.trim()) ? letter.trim().toUpperCase() : letter || "",
          staffKey:
            ki?.kind === "mcq"
              ? { correct: ki.correct, points: ki.points }
              : undefined,
          aiDraft,
        };
      }
      return {
        index: idx + 1,
        kind: "fill" as const,
        id: q.id,
        prompt: q.prompt,
        answerText: letter,
        staffKey:
          ki?.kind === "fill"
            ? { rubricForAi: ki.rubricForAi, maxPoints: ki.maxPoints }
            : undefined,
        aiDraft,
      };
    });

    const uiPhase =
      tt.status === "ACTIVE" && tt.sessionState === "paused"
        ? "in_progress_paused"
        : tt.status === "ACTIVE"
          ? "in_progress"
          : tt.status === "AWAITING_STAFF"
            ? "awaiting_manual_review"
            : tt.status.toLowerCase();

    return NextResponse.json({
      attemptId: tt.id,
      username: tt.user?.username ?? null,
      status: tt.status,
      uiPhase,
      sessionState: tt.sessionState ?? null,
      submittedAt: tt.submittedAt?.toISOString() ?? null,
      answerCount: Object.keys(answers).length,
      aiSummary,
      items,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
