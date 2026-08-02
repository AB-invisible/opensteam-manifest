/**
 * Keystroke / typing analytics for the Executive Officer exam.
 *
 * The browser reports a cumulative per-question snapshot (chars, keystrokes, backspaces, active
 * typing time, first-keystroke latency) on each autosave. This module sanitizes those snapshots and
 * derives aggregate speed/fluency figures (WPM, edit rate, latency) used both for the results view
 * and as one input to the CEFR English-level estimate.
 */

/** Standard "word" length used for WPM (5 characters incl. the trailing space). */
export const CHARS_PER_WORD = 5;

export type QuestionTyping = {
  /** Final visible character count of the answer. */
  chars: number;
  /** Total key presses including edits/backspaces. */
  keystrokes: number;
  /** Backspace / delete presses. */
  backspaces: number;
  /** Active typing time in ms (idle gaps above a threshold are excluded client-side). */
  activeMs: number;
  /** Focus -> first keystroke latency in ms (null if never typed). */
  firstKeyLatencyMs: number | null;
};

export type TypingMetrics = {
  perQuestion: Record<string, QuestionTyping>;
  overall: {
    questionsTyped: number;
    totalChars: number;
    totalKeystrokes: number;
    totalBackspaces: number;
    totalActiveMs: number;
    words: number;
    /** Words per minute over active typing time. */
    wpm: number;
    /** Fraction of keystrokes that were edits/backspaces (0..1). */
    backspaceRate: number;
    /** Mean focus->first-key latency in ms across answered questions. */
    avgFirstKeyLatencyMs: number | null;
  };
};

function n(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(Math.round(x), max);
}

/** Coerce an untrusted client per-question typing snapshot into a clean map. */
export function sanitizePerQuestionTyping(raw: unknown): Record<string, QuestionTyping> {
  const out: Record<string, QuestionTyping> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    // Cap absurd values so a tampered client cannot inflate WPM without bound.
    const chars = n(o.chars, 100_000);
    const keystrokes = n(o.keystrokes, 500_000);
    const backspaces = Math.min(n(o.backspaces, 500_000), keystrokes);
    const activeMs = n(o.activeMs, 24 * 60 * 60 * 1000);
    const latency = o.firstKeyLatencyMs == null ? null : n(o.firstKeyLatencyMs, 60 * 60 * 1000);
    out[k] = { chars, keystrokes, backspaces, activeMs, firstKeyLatencyMs: latency };
  }
  return out;
}

/** Merge a fresh per-question snapshot over the stored one (client sends cumulative values). */
export function mergePerQuestionTyping(
  stored: unknown,
  incoming: Record<string, QuestionTyping>,
): Record<string, QuestionTyping> {
  const base = sanitizePerQuestionTyping(stored);
  return { ...base, ...incoming };
}

/** Compute aggregate speed/fluency figures from a per-question typing map. */
export function finalizeTypingMetrics(perQuestion: Record<string, QuestionTyping>): TypingMetrics {
  let totalChars = 0;
  let totalKeystrokes = 0;
  let totalBackspaces = 0;
  let totalActiveMs = 0;
  let questionsTyped = 0;
  let latencySum = 0;
  let latencyCount = 0;

  for (const q of Object.values(perQuestion)) {
    if (q.keystrokes <= 0 && q.chars <= 0) continue;
    questionsTyped += 1;
    totalChars += q.chars;
    totalKeystrokes += q.keystrokes;
    totalBackspaces += q.backspaces;
    totalActiveMs += q.activeMs;
    if (q.firstKeyLatencyMs != null) {
      latencySum += q.firstKeyLatencyMs;
      latencyCount += 1;
    }
  }

  const words = totalChars / CHARS_PER_WORD;
  const minutes = totalActiveMs / 60_000;
  const wpm = minutes > 0 ? Math.round((words / minutes) * 10) / 10 : 0;
  const backspaceRate = totalKeystrokes > 0 ? Math.round((totalBackspaces / totalKeystrokes) * 1000) / 1000 : 0;
  const avgFirstKeyLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : null;

  return {
    perQuestion,
    overall: {
      questionsTyped,
      totalChars,
      totalKeystrokes,
      totalBackspaces,
      totalActiveMs,
      words: Math.round(words),
      wpm,
      backspaceRate,
      avgFirstKeyLatencyMs,
    },
  };
}
