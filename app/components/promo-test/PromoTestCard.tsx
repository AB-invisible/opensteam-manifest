"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpCircle, Clock, Loader2 } from "lucide-react";

type TierInfo = {
  label: string;
  fromRoleName: string;
  toRoleName: string;
  mcqCount: number;
  fillCount: number;
  mcqMinutes: number;
  fillMinutes: number;
  tenureDays: number;
};

type PromoState = {
  eligible: boolean;
  eligibilityReason: string | null;
  tier: TierInfo | null;
  tenureDays: number | null;
  requiredDays: number | null;
  hasPassed: boolean;
  pendingReviewAttemptId: string | null;
  attempt: { id: string } | null;
  supersededByExecutive?: boolean;
};

/** Eligibility-gated promotion exam entry point for the dashboard Tests tab. */
export default function PromoTestCard() {
  const router = useRouter();
  const [state, setState] = useState<PromoState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/promo-test", { cache: "no-store" });
        const d = res.ok ? await res.json() : null;
        if (alive) setState(d);
      } catch {
        if (alive) setState(null);
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
        Checking promotion eligibility…
      </div>
    );
  }

  // Head Moderator track uses the Executive Officer exam instead of promo tiers.
  if (!state || state.supersededByExecutive || (!state.tier && !state.eligible)) return null;

  const tier = state.tier;
  const inProgress = Boolean(state.attempt);
  const pending = Boolean(state.pendingReviewAttemptId);
  const canOpen = state.eligible || inProgress || pending || state.hasPassed;

  const accent = state.eligible || inProgress ? "indigo" : state.hasPassed ? "emerald" : "white";
  const borderClass =
    accent === "indigo"
      ? "border-indigo-500/25 bg-indigo-500/10"
      : accent === "emerald"
        ? "border-emerald-500/25 bg-emerald-500/10"
        : "border-white/10 bg-white/5";

  return (
    <div className={`mb-6 rounded-2xl border p-5 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <ArrowUpCircle className="mt-0.5 h-6 w-6 shrink-0 text-indigo-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">
            {tier ? tier.label : "Moderator Promotion"}
            {tier ? (
              <span className="ml-2 text-[11px] font-semibold text-zinc-400">
                {tier.fromRoleName} → {tier.toRoleName}
              </span>
            ) : null}
          </p>

          {pending ? (
            <p className="mt-1 text-xs text-amber-200/90">Your submission is awaiting staff review.</p>
          ) : state.hasPassed ? (
            <p className="mt-1 text-xs text-emerald-200/90">You passed this promotion exam.</p>
          ) : inProgress ? (
            <p className="mt-1 text-xs text-indigo-200/90">You have an exam in progress — resume it.</p>
          ) : state.eligible && tier ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {tier.mcqCount} multiple choice ({tier.mcqMinutes}m) + {tier.fillCount} written ({tier.fillMinutes}m). Timed, AI-graded,
              staff-confirmed.
            </p>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {state.eligibilityReason ?? "Not eligible yet."}
            </p>
          )}

          {tier && state.requiredDays != null && !state.eligible && !inProgress && !pending && !state.hasPassed ? (
            <p className="mt-2 text-[11px] text-zinc-500">
              Tenure as {tier.fromRoleName}: <strong className="text-zinc-300">{Math.floor(state.tenureDays ?? 0)}</strong> /{" "}
              {state.requiredDays} days required.
            </p>
          ) : null}

          {canOpen ? (
            <button
              type="button"
              onClick={() => router.push("/dashboard/promo-test")}
              className="mt-4 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-5 py-2 text-xs font-bold uppercase tracking-widest text-indigo-100 transition-colors hover:bg-indigo-500/30"
            >
              {inProgress ? "Resume promotion exam" : pending || state.hasPassed ? "View promotion exam" : "Open promotion exam"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
