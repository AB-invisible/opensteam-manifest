/**
 * Per-category grading, handled-level assessment, and AI expertise summaries for the Executive
 * Officer exam. Category 5 (fit) receives a holistic readiness evaluation — professional context
 * only, never personal-life inference.
 */
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq } from "@/app/lib/mod-assessment-types";
import type { AiGradePayload, QuestionGradeDetail } from "@/app/lib/mod-assessment-grade";
import { modAssessmentChatCompletion } from "@/app/lib/mod-assessment-llm";
import { safeErrorMessage } from "@/app/lib/auth-helpers";
import {
  EXEC_CATEGORIES,
  EXEC_CATEGORY_MAP,
  questionsByCategory,
  scoreToHandledLevel,
  HANDLED_LABELS,
  type ExecCategoryId,
  type HandledLevel,
} from "@/app/lib/exec-categories";
import type { EnglishAssessment } from "@/app/lib/english-level";
import type { TypingMetrics } from "@/app/lib/typing-metrics";

export type CategoryGradeReport = {
  categoryId: ExecCategoryId;
  label: string;
  difficulty: string;
  isFit: boolean;
  earned: number;
  max: number;
  pct: number;
  handledLevel: HandledLevel;
  handledLabel: string;
  mcqEarned: number;
  mcqMax: number;
  writtenEarned: number;
  writtenMax: number;
  /** AI narrative for owner PDF — expertise or fit readiness. */
  expertiseSummary: string;
  strengths: string[];
  gaps: string[];
  /** Fit-only: holistic recommendation */
  fitRecommendation?: "not_ready" | "conditional" | "ready" | "strong_fit";
  fitRationale?: string;
};

export type ExecCategoryReports = {
  categories: CategoryGradeReport[];
  overallFit?: {
    recommendation: CategoryGradeReport["fitRecommendation"];
    rationale: string;
    englishLevel: string | null;
    crossCategoryNotes: string;
  };
  generatedAt: string;
};

function sumCategory(
  qs: ModQuestion[],
  grade: AiGradePayload,
): { earned: number; max: number; mcqE: number; mcqM: number; wE: number; wM: number } {
  let earned = 0;
  let max = 0;
  let mcqE = 0;
  let mcqM = 0;
  let wE = 0;
  let wM = 0;
  for (const q of qs) {
    const g = grade.byQuestionId[q.id];
    const e = g?.earned ?? 0;
    const m = g?.max ?? (isMcq(q) ? q.points ?? 10 : q.maxPoints);
    earned += e;
    max += m;
    if (isMcq(q)) {
      mcqE += e;
      mcqM += m;
    } else {
      wE += e;
      wM += m;
    }
  }
  return { earned, max, mcqE, mcqM, wE, wM };
}

async function summarizeExpertiseCategory(args: {
  catLabel: string;
  difficulty: string;
  handledLevel: HandledLevel;
  pct: number;
  questions: ModQuestion[];
  answers: Record<string, string>;
  grades: Record<string, QuestionGradeDetail>;
}): Promise<{ summary: string; strengths: string[]; gaps: string[] }> {
  const samples = args.questions
    .filter((q) => !isMcq(q))
    .slice(0, 4)
    .map((q) => ({
      prompt: q.prompt.slice(0, 280),
      answer: (args.answers[q.id] ?? "").slice(0, 400),
      score: args.grades[q.id]?.earned ?? 0,
      max: args.grades[q.id]?.max ?? q.maxPoints,
    }));

  try {
    const { content } = await modAssessmentChatCompletion({
      temperature: 0.2,
      response_format: { type: "json_object" },
      skipLocalLlm: true,
      messages: [
        {
          role: "system",
          content: `You write concise executive-assessment notes for an OWNER-ONLY internal report. Professional tone. No personal-life speculation. JSON only:
{"summary":"2-3 sentences","strengths":["bullet"],"gaps":["bullet"]}
Max 3 strengths and 3 gaps. Summary references how they handled ${args.difficulty} tier items (${args.handledLevel}, ${args.pct}% in ${args.catLabel}).`,
        },
        {
          role: "user",
          content: JSON.stringify({ category: args.catLabel, pct: args.pct, handledLevel: args.handledLevel, writtenSamples: samples }),
        },
      ],
    });
    const p = JSON.parse(content) as { summary?: string; strengths?: string[]; gaps?: string[] };
    return {
      summary: typeof p.summary === "string" ? p.summary.slice(0, 600) : `Scored ${args.pct}% on ${args.catLabel}.`,
      strengths: Array.isArray(p.strengths) ? p.strengths.slice(0, 3).map(String) : [],
      gaps: Array.isArray(p.gaps) ? p.gaps.slice(0, 3).map(String) : [],
    };
  } catch {
    return {
      summary: `${args.catLabel}: ${args.pct}% at ${args.difficulty} tier — ${HANDLED_LABELS[args.handledLevel]}.`,
      strengths: [],
      gaps: [],
    };
  }
}

async function evaluateFitCategory(args: {
  questions: ModQuestion[];
  answers: Record<string, string>;
  grades: Record<string, QuestionGradeDetail>;
  categoryReports: CategoryGradeReport[];
  english: EnglishAssessment | null;
}): Promise<{ summary: string; recommendation: CategoryGradeReport["fitRecommendation"]; rationale: string }> {
  const fitAnswers = args.questions.map((q) => ({
    prompt: q.prompt.slice(0, 320),
    answer: (args.answers[q.id] ?? "").slice(0, 500),
    score: args.grades[q.id]?.earned ?? 0,
    max: args.grades[q.id]?.max ?? (isMcq(q) ? q.points ?? 10 : q.maxPoints),
  }));

  const expertiseSnapshot = args.categoryReports
    .filter((c) => !c.isFit)
    .map((c) => ({ category: c.label, pct: c.pct, handled: c.handledLevel }));

  try {
    const { content } = await modAssessmentChatCompletion({
      temperature: 0.15,
      response_format: { type: "json_object" },
      skipLocalLlm: true,
      messages: [
        {
          role: "system",
          content: `You assess EXECUTIVE READINESS for a moderation leadership role from professional situational answers only.

NEVER infer or mention: family, relationships, health, religion, politics, private life, or protected characteristics.

JSON only:
{"summary":"2-3 sentences on leadership readiness","recommendation":"not_ready|conditional|ready|strong_fit","rationale":"2 sentences","crossCategoryNotes":"1 sentence tying expertise scores to fit"}

recommendation guide:
- not_ready: clear gaps in judgement, safety, or communication at executive scale
- conditional: promising but needs mentoring / more evidence in specific areas
- ready: solid executive judgement across scenarios
- strong_fit: exceptional clarity, ethics, and scalable leadership thinking`,
        },
        {
          role: "user",
          content: JSON.stringify({
            fitAnswers,
            expertiseSnapshot,
            englishLevel: args.english?.level ?? null,
          }),
        },
      ],
    });
    const p = JSON.parse(content) as {
      summary?: string;
      recommendation?: string;
      rationale?: string;
      crossCategoryNotes?: string;
    };
    const rec = ["not_ready", "conditional", "ready", "strong_fit"].includes(p.recommendation ?? "")
      ? (p.recommendation as CategoryGradeReport["fitRecommendation"])
      : "conditional";
    return {
      summary: typeof p.summary === "string" ? p.summary.slice(0, 600) : "Fit assessment completed.",
      recommendation: rec,
      rationale:
        (typeof p.rationale === "string" ? p.rationale : "") +
        (typeof p.crossCategoryNotes === "string" ? ` ${p.crossCategoryNotes}` : ""),
    };
  } catch (e) {
    const avgFit =
      fitAnswers.length > 0
        ? fitAnswers.reduce((a, x) => a + (x.max > 0 ? x.score / x.max : 0), 0) / fitAnswers.length
        : 0;
    const rec: CategoryGradeReport["fitRecommendation"] =
      avgFit >= 0.8 ? "ready" : avgFit >= 0.55 ? "conditional" : "not_ready";
    return {
      summary: `Fit block average ${Math.round(avgFit * 100)}%. Heuristic assessment (AI unavailable: ${safeErrorMessage(e)}).`,
      recommendation: rec,
      rationale: "Based on written fit scenarios and expertise category scores.",
    };
  }
}

/** Build per-category owner reports after the main AI grade completes. */
export async function buildExecCategoryReports(opts: {
  questions: ModQuestion[];
  answers: Record<string, string>;
  grade: AiGradePayload;
  english: EnglishAssessment | null;
  typing: TypingMetrics | null;
}): Promise<ExecCategoryReports> {
  const byCat = questionsByCategory(opts.questions);
  const categories: CategoryGradeReport[] = [];

  for (const def of EXEC_CATEGORIES) {
    const qs = byCat.get(def.id) ?? [];
    if (qs.length === 0) continue;

    const sums = sumCategory(qs, opts.grade);
    const pct = sums.max > 0 ? Math.round((sums.earned / sums.max) * 1000) / 10 : 0;
    const handledLevel = scoreToHandledLevel(pct);

    let expertiseSummary: string;
    let strengths: string[] = [];
    let gaps: string[] = [];
    let fitRecommendation: CategoryGradeReport["fitRecommendation"];
    let fitRationale: string | undefined;

    if (def.isFit) {
      // Placeholder — filled after expertise categories exist
      expertiseSummary = "";
    } else {
      const narrative = await summarizeExpertiseCategory({
        catLabel: def.label,
        difficulty: def.difficulty,
        handledLevel,
        pct,
        questions: qs,
        answers: opts.answers,
        grades: opts.grade.byQuestionId,
      });
      expertiseSummary = narrative.summary;
      strengths = narrative.strengths;
      gaps = narrative.gaps;
    }

    categories.push({
      categoryId: def.id,
      label: def.label,
      difficulty: def.difficulty,
      isFit: def.isFit,
      earned: sums.earned,
      max: sums.max,
      pct,
      handledLevel,
      handledLabel: HANDLED_LABELS[handledLevel],
      mcqEarned: sums.mcqE,
      mcqMax: sums.mcqM,
      writtenEarned: sums.wE,
      writtenMax: sums.wM,
      expertiseSummary,
      strengths,
      gaps,
      fitRecommendation,
      fitRationale,
    });
  }

  const expertiseOnly = categories.filter((c) => !c.isFit);
  const fitIdx = categories.findIndex((c) => c.isFit);
  let overallFit: ExecCategoryReports["overallFit"];

  if (fitIdx >= 0) {
    const fitQs = byCat.get("fit") ?? [];
    const fitEval = await evaluateFitCategory({
      questions: fitQs,
      answers: opts.answers,
      grades: opts.grade.byQuestionId,
      categoryReports: expertiseOnly,
      english: opts.english,
    });
    categories[fitIdx].expertiseSummary = fitEval.summary;
    categories[fitIdx].fitRecommendation = fitEval.recommendation;
    categories[fitIdx].fitRationale = fitEval.rationale;
    overallFit = {
      recommendation: fitEval.recommendation,
      rationale: fitEval.rationale.slice(0, 800),
      englishLevel: opts.english?.level ?? null,
      crossCategoryNotes: `Typing ~${opts.typing?.overall.wpm ?? 0} WPM across written items.`,
    };
  }

  return { categories, overallFit, generatedAt: new Date().toISOString() };
}

export function parseCategoryReports(raw: unknown): ExecCategoryReports | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as ExecCategoryReports;
  if (!Array.isArray(r.categories)) return null;
  return r;
}

export function categoryDefForReport(id: ExecCategoryId) {
  return EXEC_CATEGORY_MAP[id];
}
