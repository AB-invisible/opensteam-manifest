/** Single overall timer helpers for the Executive Officer exam (server-authoritative deadline). */
import type { PromoTier } from "@/app/lib/promo-tiers";

/** Executive Officer exam — single overall deadline + optional adaptive category progress. */
import type { ExecCategoryProgress } from "@/app/lib/exec-adaptive";

export type ExecTimer = { startedAt: string; endsAt: string };
export type ExecTimerState = {
  exam?: ExecTimer;
  categoryProgress?: ExecCategoryProgress;
};

/** Grace so a borderline autosave/submit right at the deadline is not unfairly rejected. */
export const EXEC_TIMER_GRACE_MS = 5000;

export function parseExecTimerState(raw: unknown): ExecTimerState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ExecTimerState;
}

export function buildExecTimerState(tier: PromoTier, now: Date): ExecTimerState {
  const minutes = tier.examMinutes ?? 240;
  return {
    exam: {
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
    },
  };
}

/** True when the overall deadline has passed (beyond the grace window). */
export function isExecExpired(state: ExecTimerState, now: Date = new Date()): boolean {
  const t = state.exam;
  if (!t) return false;
  return now.getTime() > new Date(t.endsAt).getTime() + EXEC_TIMER_GRACE_MS;
}
