/** Section + timer helpers for promotional exams (server-authoritative deadlines). */
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq } from "@/app/lib/mod-assessment-types";
import type { PromoTier } from "@/app/lib/promo-tiers";

export type PromoSection = "mcq" | "fill";

export type SectionTimer = { startedAt: string; endsAt: string };
export type PromoTimerState = {
  mcq?: SectionTimer;
  fill?: SectionTimer;
};

/** Small grace so a borderline autosave/submit at the deadline isn't unfairly rejected. */
export const TIMER_GRACE_MS = 4000;

export function sectionForQuestion(q: ModQuestion): PromoSection {
  return isMcq(q) ? "mcq" : "fill";
}

export function parseTimerState(raw: unknown): PromoTimerState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as PromoTimerState;
}

export function buildInitialTimerState(tier: PromoTier, now: Date): PromoTimerState {
  return {
    mcq: {
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + tier.mcqMinutes * 60_000).toISOString(),
    },
  };
}

export function withFillTimer(
  state: PromoTimerState,
  tier: PromoTier,
  now: Date,
): PromoTimerState {
  if (state.fill) return state;
  return {
    ...state,
    fill: {
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + tier.fillMinutes * 60_000).toISOString(),
    },
  };
}

/** True when the section has a deadline that is already past (beyond the grace window). */
export function isSectionExpired(
  state: PromoTimerState,
  section: PromoSection,
  now: Date = new Date(),
): boolean {
  const t = state[section];
  if (!t) return false;
  return now.getTime() > new Date(t.endsAt).getTime() + TIMER_GRACE_MS;
}
