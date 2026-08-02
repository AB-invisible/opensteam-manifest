import type { ModQuestion, ModQuestionFill } from "@/app/lib/mod-assessment-types";
import { isMcq } from "@/app/lib/mod-assessment-types";
import { safeErrorMessage } from "@/app/lib/auth-helpers";
import { modAssessmentChatCompletion } from "@/app/lib/mod-assessment-llm";

export type QuestionGradeDetail = {
  id: string;
  earned: number;
  max: number;
  source: "mcq" | "ai";
  rationale?: string;
};

export type AiGradePayload = {
  byQuestionId: Record<string, QuestionGradeDetail>;
  totalEarned: number;
  totalMax: number;
  aiModel?: string;
  gradedAt?: string;
};

/** Per-question rows from JSON stored on `TrialTest.aiGrade` (empty if missing/malformed). */
export function perQuestionScoresFromStoredAiGrade(
  raw: unknown,
): Partial<Record<string, { earned: number; max: number }>> {
  const out: Partial<Record<string, { earned: number; max: number }>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const g = raw as Partial<AiGradePayload>;
  const bq = g.byQuestionId;
  if (!bq || typeof bq !== "object" || Array.isArray(bq)) return out;
  for (const [qid, v] of Object.entries(bq)) {
    if (!v || typeof v !== "object") continue;
    const d = v as Partial<QuestionGradeDetail>;
    if (typeof d.earned === "number" && typeof d.max === "number") {
      out[qid] = { earned: d.earned, max: d.max };
    }
  }
  return out;
}

const FILL_GRADER_SYSTEM = `You grade short written answers for a Discord mod exam.

Output only valid JSON: {"score":number,"rationale":string}.

Scoring:
- "score" is an integer from 0 through maxScore (maxScore is in the user JSON).
- Follow the rubric first; the question text is the situation you're grading.
- Only reward content that actually fits the question. Vague generic mod advice or filler → very low score (0–2 when maxScore is 10).
- Reward sensible safe choices, clear escalation when the situation needs it, and concrete steps (who to tell, what to log). Penalize unsafe advice, encouraging pile-ons, or skipping escalation when it's obviously required.
- Partial credit if the answer is incomplete but still basically right and safe.
- Off-topic, wrong language, or meaningless one-liners → 0 unless maxScore is tiny.
- "rationale": max 2 sentences, plain English—what they got right or wrong vs the rubric.`;

async function chatJson(payload: Record<string, unknown>): Promise<{
  score: number;
  rationale?: string;
  modelLabel: string;
}> {
  const { content, label } = await modAssessmentChatCompletion({
    temperature: 0.15,
    response_format: { type: "json_object" },
    skipLocalLlm: true,
    messages: [
      {
        role: "system",
        content: FILL_GRADER_SYSTEM,
      },
      {
        role: "user",
        content: JSON.stringify({
          question: payload.question,
          rubric: payload.rubric,
          answer: payload.answer,
          maxScore: payload.maxScore,
        }),
      },
    ],
  });

  return {
    ...(JSON.parse(content) as { score: number; rationale?: string }),
    modelLabel: label,
  };
}

export async function gradeFillQuestion(args: {
  questionPrompt: string;
  rubric: string;
  userAnswer: string;
  maxPoints: number;
}) {
  const max = Math.max(0, args.maxPoints);

  const parsed = await chatJson({
    question: args.questionPrompt,
    rubric: args.rubric,
    answer: args.userAnswer,
    maxScore: max,
  });

  const raw = Number(parsed.score);
  const earned = Number.isFinite(raw)
    ? Math.min(max, Math.max(0, Math.round(raw)))
    : 0;

  return {
    earned,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    modelLabel: parsed.modelLabel,
  };
}

/** Deterministic MCQ + AI-assisted fill grading — combined payload for DB + staff UI. */
export async function buildAiGrade(opts: {
  questions: ModQuestion[];
  answers: Record<string, string>;
}): Promise<AiGradePayload> {
  const byQuestionId: Record<string, QuestionGradeDetail> = {};
  const fills: ModQuestionFill[] = [];

  let totalEarned = 0;
  let totalMax = 0;

  for (const q of opts.questions) {
    const raw = opts.answers[q.id]?.trim() ?? "";

    if (isMcq(q)) {
      const pts = q.points ?? 10;
      totalMax += pts;
      const ok = raw.length === 1 && raw.toUpperCase() === q.correct.toUpperCase();
      const earned = ok ? pts : 0;
      totalEarned += earned;
      byQuestionId[q.id] = {
        id: q.id,
        earned,
        max: pts,
        source: "mcq",
        rationale: ok ? "Correct option." : "Incorrect option.",
      };
    } else {
      fills.push(q);
      totalMax += q.maxPoints;
    }
  }

  const modelsUsed = new Set<string>();

  for (const q of fills) {
    const raw = opts.answers[q.id]?.trim() ?? "";
    if (!raw.length) {
      byQuestionId[q.id] = {
        id: q.id,
        earned: 0,
        max: q.maxPoints,
        source: "ai",
        rationale: "No answer provided.",
      };
      continue;
    }
    try {
      const g = await gradeFillQuestion({
        questionPrompt: q.prompt,
        rubric: q.rubricForAi,
        userAnswer: raw,
        maxPoints: q.maxPoints,
      });
      if (g.modelLabel) modelsUsed.add(g.modelLabel);
      totalEarned += g.earned;
      byQuestionId[q.id] = {
        id: q.id,
        earned: g.earned,
        max: q.maxPoints,
        source: "ai",
        rationale: g.rationale,
      };
    } catch (e) {
      byQuestionId[q.id] = {
        id: q.id,
        earned: 0,
        max: q.maxPoints,
        source: "ai",
        rationale: `AI grading failed: ${safeErrorMessage(e)}`,
      };
    }
  }

  const anyFillAnswered = fills.some(
    (q) => (opts.answers[q.id]?.trim() ?? "").length > 0
  );

  let aiModel: string;
  if (!anyFillAnswered) {
    aiModel = "no written answers graded";
  } else if (modelsUsed.size > 0) {
    aiModel = [...modelsUsed].join(", ");
  } else {
    aiModel = process.env.GROQ_MODEL || "Groq/Local Fallback";
  }

  return {
    byQuestionId,
    totalEarned,
    totalMax,
    aiModel,
    gradedAt: new Date().toISOString(),
  };
}
