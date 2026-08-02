/**
 * Adaptive difficulty between Executive Officer exam categories.
 *
 * Categories unlock sequentially. After each expertise block, a quick score (MCQ-weighted for
 * speed) determines how the candidate handled that tier; the NEXT category is generated at an
 * adjusted difficulty. Category 5 (fit) is always generated last with a professional context
 * summary — never personal-life probing.
 */
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq } from "@/app/lib/mod-assessment-types";
import {
  EXEC_CATEGORIES,
  scoreToHandledLevel,
  type ExecCategoryId,
  type ExecDifficulty,
  type HandledLevel,
} from "@/app/lib/exec-categories";

const DIFFICULTY_ORDER: ExecDifficulty[] = ["foundation", "advanced", "expert", "executive"];

export type CategoryProgressEntry = {
  categoryId: ExecCategoryId;
  /** Difficulty tier used when this category was generated. */
  appliedDifficulty: ExecDifficulty;
  /** Quick score % used for adaptation (MCQ-heavy at advance time). */
  pct: number;
  handledLevel: HandledLevel;
  completedAt: string;
};

export type ExecCategoryProgress = {
  currentCategoryId: ExecCategoryId;
  completed: CategoryProgressEntry[];
};

export function parseCategoryProgress(raw: unknown): ExecCategoryProgress | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as ExecCategoryProgress;
  if (!o.currentCategoryId || !Array.isArray(o.completed)) return null;
  return o;
}

export function initialCategoryProgress(): ExecCategoryProgress {
  return { currentCategoryId: EXEC_CATEGORIES[0].id, completed: [] };
}

export function nextCategoryId(current: ExecCategoryId): ExecCategoryId | null {
  const idx = EXEC_CATEGORIES.findIndex((c) => c.id === current);
  if (idx < 0 || idx >= EXEC_CATEGORIES.length - 1) return null;
  return EXEC_CATEGORIES[idx + 1].id;
}

/** Bump difficulty up/down one step based on how the last category was handled. */
export function adjustDifficultyForHandling(
  baseDifficulty: ExecDifficulty,
  handledLevel: HandledLevel,
): ExecDifficulty {
  const idx = DIFFICULTY_ORDER.indexOf(baseDifficulty);
  const safeIdx = idx >= 0 ? idx : 2;
  let next = safeIdx;
  if (handledLevel === "exceptional" || handledLevel === "strong") next = Math.min(DIFFICULTY_ORDER.length - 1, safeIdx + 1);
  else if (handledLevel === "below_expectation" || handledLevel === "developing") next = Math.max(0, safeIdx - 1);
  return DIFFICULTY_ORDER[next];
}

/**
 * Fast category score at advance time — MCQ answers are deterministic; written items count as
 * unanswered (0) unless we want to wait for AI. Keeps adaptation snappy between categories.
 */
export function quickCategoryScorePct(
  questions: ModQuestion[],
  answers: Record<string, string>,
): number {
  let earned = 0;
  let max = 0;
  for (const q of questions) {
    if (!isMcq(q)) continue;
    const pts = q.points ?? 10;
    max += pts;
    const raw = (answers[q.id] ?? "").trim().toUpperCase();
    if (raw === q.correct.toUpperCase()) earned += pts;
  }
  if (max === 0) return 0;
  return Math.round((earned / max) * 1000) / 10;
}

export function recordCategoryCompletion(args: {
  progress: ExecCategoryProgress;
  categoryId: ExecCategoryId;
  appliedDifficulty: ExecDifficulty;
  questions: ModQuestion[];
  answers: Record<string, string>;
}): { entry: CategoryProgressEntry; progress: ExecCategoryProgress } {
  const catQs = args.questions.filter((q) => q.category === args.categoryId);
  const pct = quickCategoryScorePct(catQs, args.answers);
  const handledLevel = scoreToHandledLevel(pct);
  const entry: CategoryProgressEntry = {
    categoryId: args.categoryId,
    appliedDifficulty: args.appliedDifficulty,
    pct,
    handledLevel,
    completedAt: new Date().toISOString(),
  };
  return {
    entry,
    progress: {
      currentCategoryId: args.progress.currentCategoryId,
      completed: [...args.progress.completed, entry],
    },
  };
}

/** Resolved difficulty for generating the next category after prior completions. */
export function difficultyForCategory(
  categoryId: ExecCategoryId,
  progress: ExecCategoryProgress,
): ExecDifficulty {
  const def = EXEC_CATEGORIES.find((c) => c.id === categoryId);
  if (!def) return "expert";
  if (def.isFit) return def.difficulty;

  const prior = progress.completed.filter((e) => e.categoryId !== "fit");
  if (prior.length === 0) return def.difficulty;

  const last = prior[prior.length - 1];
  return adjustDifficultyForHandling(def.difficulty, last.handledLevel);
}

/** Professional context lines for fit-category generation (no personal data). */
export function fitGenerationContext(progress: ExecCategoryProgress): string {
  const lines = progress.completed
    .filter((e) => e.categoryId !== "fit")
    .map((e) => `${e.categoryId}: ${e.pct}% at ${e.appliedDifficulty} tier (${e.handledLevel})`);
  return lines.length
    ? `Prior expertise blocks (work performance only): ${lines.join("; ")}.`
    : "No prior blocks completed.";
}
