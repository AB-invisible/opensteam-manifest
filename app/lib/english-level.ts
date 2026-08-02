/**
 * Estimated CEFR / Cambridge English level for an Executive Officer exam candidate.
 *
 * Combines two signals (per the exam design):
 *   1. AI-judged written-English quality across the candidate's written answers (grammar range &
 *      accuracy, lexical resource, coherence, complexity) mapped onto the CEFR framework, and
 *   2. Typing fluency derived from keystroke analytics (WPM, edit rate, latency).
 *
 * The written-language signal dominates (0.8) with typing fluency as a supporting signal (0.2).
 * The result maps to a CEFR band (A1..C2) and the equivalent Cambridge English qualification.
 */
import { modAssessmentChatCompletion } from "@/app/lib/mod-assessment-llm";
import { safeErrorMessage } from "@/app/lib/auth-helpers";
import type { TypingMetrics } from "@/app/lib/typing-metrics";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type EnglishDimensions = {
  grammar: number; // 0..100
  vocabulary: number; // 0..100 (lexical resource)
  coherence: number; // 0..100 (coherence & cohesion)
  complexity: number; // 0..100 (range / sophistication)
  accuracy: number; // 0..100 (error control)
};

export type EnglishAssessment = {
  level: CefrLevel;
  cambridgeExam: string;
  /** 0..100 blended score behind the level. */
  overallScore: number;
  /** 0..1 confidence given sample size + signal agreement. */
  confidence: number;
  languageScore: number; // 0..100 (AI written-language signal)
  typingScore: number; // 0..100 (typing fluency signal)
  dimensions: EnglishDimensions;
  wordsAnalyzed: number;
  wpm: number;
  rationale: string;
  aiModel: string;
  method: "ai" | "heuristic";
  assessedAt: string;
};

const CEFR_BANDS: { min: number; level: CefrLevel }[] = [
  { min: 88, level: "C2" },
  { min: 75, level: "C1" },
  { min: 60, level: "B2" },
  { min: 45, level: "B1" },
  { min: 28, level: "A2" },
  { min: 0, level: "A1" },
];

const CAMBRIDGE_EXAM: Record<CefrLevel, string> = {
  C2: "C2 Proficiency (CPE)",
  C1: "C1 Advanced (CAE)",
  B2: "B2 First (FCE)",
  B1: "B1 Preliminary (PET)",
  A2: "A2 Key (KET)",
  A1: "Pre-A1 / A1",
};

export function scoreToCefr(score: number): CefrLevel {
  const clamped = Math.max(0, Math.min(100, score));
  return (CEFR_BANDS.find((b) => clamped >= b.min) ?? CEFR_BANDS[CEFR_BANDS.length - 1]).level;
}

export function cambridgeExamForLevel(level: CefrLevel): string {
  return CAMBRIDGE_EXAM[level];
}

function clamp01to100(v: unknown): number {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * Typing fluency (0..100): fast, low-edit, low-latency typing scores higher. This is a supporting
 * signal only — it cannot by itself certify language ability.
 */
export function typingFluencyScore(typing: TypingMetrics | null | undefined): number {
  if (!typing || typing.overall.questionsTyped === 0 || typing.overall.totalActiveMs <= 0) return 0;
  const { wpm, backspaceRate, avgFirstKeyLatencyMs } = typing.overall;

  // WPM: 15 wpm -> 0, 65 wpm -> 100 (typical fluent second-language typist band).
  const wpmScore = Math.max(0, Math.min(100, ((wpm - 15) / (65 - 15)) * 100));
  // Heavy editing suggests less fluent composition; penalize above 20% backspaces.
  const editPenalty = Math.max(0, (backspaceRate - 0.2)) * 120;
  // Long think-before-typing latency (> 4s avg) is a mild penalty.
  const latencyPenalty =
    avgFirstKeyLatencyMs != null ? Math.max(0, (avgFirstKeyLatencyMs - 4000) / 1000) * 3 : 0;

  return Math.max(0, Math.min(100, Math.round(wpmScore - editPenalty - latencyPenalty)));
}

const ASSESSOR_SYSTEM = `You are a Cambridge English examiner. Assess the ENGLISH LANGUAGE proficiency of a candidate from their free-text answers, ignoring whether the content/opinions are correct — judge only their command of English.

Rate each dimension 0-100 on the CEFR scale (A1≈15, A2≈35, B1≈50, B2≈68, C1≈82, C2≈93):
- grammar: range and accuracy of grammatical structures
- vocabulary: lexical resource, precision, collocation
- coherence: organisation, cohesion, linking of ideas
- complexity: sentence variety and sophistication
- accuracy: control of errors (spelling, punctuation, agreement)

Output ONLY valid JSON:
{"grammar":0,"vocabulary":0,"coherence":0,"complexity":0,"accuracy":0,"overall":0,"cefr":"B2","rationale":"one or two sentences"}

"overall" is your holistic 0-100 English level. "cefr" is one of A1,A2,B1,B2,C1,C2. If the sample is too short/empty to judge, score low and say so in the rationale.`;

function buildWritingSample(samples: string[]): { text: string; words: number } {
  const cleaned = samples.map((s) => (s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined = cleaned.map((s, i) => `Answer ${i + 1}: ${s}`).join("\n\n");
  const words = cleaned.join(" ").split(/\s+/).filter(Boolean).length;
  // Keep the model input bounded.
  return { text: joined.slice(0, 12000), words };
}

/** Heuristic fallback when the AI assessor is unavailable — rough text-feature scoring. */
function heuristicLanguageScore(samples: string[]): { score: number; dims: EnglishDimensions } {
  const text = samples.join(" ").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount < 5) {
    const dims = { grammar: 10, vocabulary: 10, coherence: 10, complexity: 10, accuracy: 10 };
    return { score: 10, dims };
  }
  const unique = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z']/g, ""))).size;
  const ttr = unique / wordCount; // type-token ratio (lexical diversity)
  const avgWordLen = words.reduce((a, w) => a + w.length, 0) / wordCount;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length || 1;
  const avgSentenceLen = wordCount / sentences;

  const lexical = Math.min(100, ttr * 140 + avgWordLen * 6);
  const structure = Math.min(100, Math.max(0, (avgSentenceLen - 4) * 6));
  const volume = Math.min(100, (wordCount / 400) * 100);
  const score = Math.round(Math.max(0, Math.min(100, lexical * 0.45 + structure * 0.35 + volume * 0.2)));
  const dims: EnglishDimensions = {
    grammar: score,
    vocabulary: Math.round(lexical),
    coherence: Math.round(structure),
    complexity: Math.round(structure),
    accuracy: score,
  };
  return { score, dims };
}

async function assessWrittenEnglishAi(
  sample: string,
): Promise<{ dims: EnglishDimensions; overall: number; rationale: string; model: string }> {
  const { content, label } = await modAssessmentChatCompletion({
    temperature: 0.1,
    response_format: { type: "json_object" },
    skipLocalLlm: true,
    messages: [
      { role: "system", content: ASSESSOR_SYSTEM },
      { role: "user", content: sample },
    ],
  });
  const parsed = JSON.parse(content) as Partial<EnglishDimensions> & {
    overall?: number;
    rationale?: string;
  };
  const dims: EnglishDimensions = {
    grammar: clamp01to100(parsed.grammar),
    vocabulary: clamp01to100(parsed.vocabulary),
    coherence: clamp01to100(parsed.coherence),
    complexity: clamp01to100(parsed.complexity),
    accuracy: clamp01to100(parsed.accuracy),
  };
  const dimAvg =
    (dims.grammar + dims.vocabulary + dims.coherence + dims.complexity + dims.accuracy) / 5;
  const overall = clamp01to100(parsed.overall ?? dimAvg);
  return {
    dims,
    overall,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 500) : "",
    model: label,
  };
}

/** Confidence from sample size (words) and agreement between the language and typing signals. */
function computeConfidence(words: number, languageScore: number, typingScore: number): number {
  const sizeConf = Math.min(1, words / 300); // ~300 words -> full size confidence
  const agreement = 1 - Math.min(1, Math.abs(languageScore - typingScore) / 100);
  const conf = 0.65 * sizeConf + 0.35 * agreement;
  return Math.round(Math.max(0.05, Math.min(1, conf)) * 100) / 100;
}

/**
 * Estimate the candidate's CEFR / Cambridge English level from their written answers + typing.
 * Never throws — falls back to a heuristic if the AI assessor is unavailable.
 */
export async function estimateEnglishLevel(opts: {
  writtenSamples: string[];
  typing: TypingMetrics | null | undefined;
}): Promise<EnglishAssessment> {
  const { text, words } = buildWritingSample(opts.writtenSamples);
  const typingScore = typingFluencyScore(opts.typing);
  const wpm = opts.typing?.overall.wpm ?? 0;

  let dims: EnglishDimensions;
  let languageScore: number;
  let rationale: string;
  let aiModel: string;
  let method: "ai" | "heuristic";

  if (words < 5) {
    const h = heuristicLanguageScore(opts.writtenSamples);
    dims = h.dims;
    languageScore = h.score;
    rationale = "Not enough written text to reliably assess English level.";
    aiModel = "insufficient-sample";
    method = "heuristic";
  } else {
    try {
      const ai = await assessWrittenEnglishAi(text);
      dims = ai.dims;
      languageScore = ai.overall;
      rationale = ai.rationale || "Assessed from written answers on the CEFR scale.";
      aiModel = ai.model || "groq";
      method = "ai";
    } catch (e) {
      const h = heuristicLanguageScore(opts.writtenSamples);
      dims = h.dims;
      languageScore = h.score;
      rationale = `Heuristic estimate (AI assessor unavailable: ${safeErrorMessage(e)}).`;
      aiModel = "heuristic-fallback";
      method = "heuristic";
    }
  }

  // Written language dominates; typing fluency supports it. If nothing was typed, use language only.
  const overallScore =
    typingScore > 0
      ? Math.round(languageScore * 0.8 + typingScore * 0.2)
      : Math.round(languageScore);
  const level = scoreToCefr(overallScore);

  return {
    level,
    cambridgeExam: cambridgeExamForLevel(level),
    overallScore,
    confidence: computeConfidence(words, languageScore, typingScore),
    languageScore,
    typingScore,
    dimensions: dims,
    wordsAnalyzed: words,
    wpm,
    rationale,
    aiModel,
    method,
    assessedAt: new Date().toISOString(),
  };
}
