/** Moderator trial length (days). Change here only — used for scheduling and UI copy. */
export const TRIAL_MOD_DAYS = 5;

export function msForTrialModDays(days: number = TRIAL_MOD_DAYS) {
  return days * 24 * 60 * 60 * 1000;
}

export function computeTrialModEnd(from: Date) {
  return new Date(from.getTime() + msForTrialModDays());
}

/** In progress: scheduled end exists, test not unlocked yet, end not passed. */
export function isTrialModPeriodActive(opts: {
  trialModEndsAt: Date | null;
  modTestReadyAt: Date | null;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  return (
    opts.trialModEndsAt !== null &&
    opts.modTestReadyAt === null &&
    opts.trialModEndsAt > now
  );
}
