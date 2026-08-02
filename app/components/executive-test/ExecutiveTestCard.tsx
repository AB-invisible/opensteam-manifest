"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Clock, Loader2 } from "lucide-react";

type TierInfo = {
  label: string;
  fromRoleName: string;
  toRoleName: string;
  mcqCount: number;
  fillCount: number;
  totalCount: number;
  examMinutes: number;
  tenureDays: number;
};

type ExecState = {
  eligible: boolean;
  eligibilityReason: string | null;
  onTrack: boolean;
  tier: TierInfo | null;
  tenureDays: number | null;
  requiredDays: number;
  hasPassed: boolean;
  pendingReviewAttemptId: string | null;
  resultStats: { englishLevel: string | null } | null;
  attempt: { id: string } | null;
};

/** Eligibility-gated Executive Officer exam entry point for the dashboard Tests tab. */
export default function ExecutiveTestCard() {
  const router = useRouter();
  const [state, setState] = useState<ExecState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/executive-test", { cache: "no-store" });
        if (!res.ok) {
          if (alive) {
            setState(null);
            setFetchFailed(true);
          }
          return;
        }
        const d = await res.json();
        if (alive) {
          setState(d);
          setFetchFailed(false);
        }
      } catch {
        if (alive) {
          setState(null);
          setFetchFailed(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Checking Executive Officer eligibility…
      </div>
    );
  }

  if (fetchFailed || !state) {
    return (
      <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200/90">
        Could not load Executive Officer exam status. Refresh the page or sign in again.
      </div>
    );
  }

  // Head Moderator track only — hide from trial mods / moderators not on this promotion step.
  if (!state.onTrack || !state.tier) return null;

  const tier = state.tier;
  const inProgress = Boolean(state.attempt);
  const pending = Boolean(state.pendingReviewAttemptId);
  const canOpen = state.eligible || inProgress || pending || state.hasPassed;

  const accent = state.eligible || inProgress ? "amber" : state.hasPassed ? "emerald" : "white";
  const borderClass =
    accent === "amber"
      ? "border-amber-500/25 bg-amber-500/10"
      : accent === "emerald"
        ? "border-emerald-500/25 bg-emerald-500/10"
        : "border-white/10 bg-white/5";
  const englishLevel = state.resultStats?.englishLevel ?? null;

  return (
    <div className={`mb-6 rounded-2xl border p-5 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <Crown className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">
            {tier.label}
            <span className="ml-2 text-[11px] font-semibold text-zinc-400">
              {tier.fromRoleName} → {tier.toRoleName}
            </span>
          </p>

          {pending ? (
            <p className="mt-1 text-xs text-amber-200/90">
              Your submission is awaiting staff review.
              {englishLevel ? ` Estimated English level: ${englishLevel}.` : ""}
            </p>
          ) : state.hasPassed ? (
            <p className="mt-1 text-xs text-emerald-200/90">
              You passed the Executive Officer exam.{englishLevel ? ` English level: ${englishLevel}.` : ""}
            </p>
          ) : inProgress ? (
            <p className="mt-1 text-xs text-amber-200/90">You have an exam in progress — resume it.</p>
          ) : state.eligible ? (
            <p className="mt-1 text-xs text-muted-foreground">
              5 categories · 160 choice + 35 written + 5 fit · 4h timer. CEFR estimate + owner-only expertise PDFs.
            </p>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {state.eligibilityReason ?? "Not eligible yet."}
            </p>
          )}

          {state.requiredDays != null && !state.eligible && !inProgress && !pending && !state.hasPassed ? (
            <p className="mt-2 text-[11px] text-zinc-500">
              Tenure as {tier.fromRoleName}: <strong className="text-zinc-300">{Math.floor(state.tenureDays ?? 0)}</strong> /{" "}
              {state.requiredDays} days required.
            </p>
          ) : null}

          {canOpen ? (
            <button
              type="button"
              onClick={() => router.push("/dashboard/executive-test")}
              className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/20 px-5 py-2 text-xs font-bold uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/30"
            >
              {inProgress ? "Resume exam" : pending || state.hasPassed ? "View exam" : "Open Executive Officer exam"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
