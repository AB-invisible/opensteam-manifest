"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { PROMO_BRAND } from "@/app/lib/promo-brand";

type PublicQuestion =
  | { id: string; type: "mcq"; prompt: string; choices: { A: string; B: string; C: string; D: string } }
  | { id: string; type: "fill"; prompt: string };

type SectionTimer = { startedAt: string; endsAt: string };
type TimerState = { mcq?: SectionTimer; fill?: SectionTimer };

type TierInfo = {
  examKind: string;
  label: string;
  fromRoleName: string;
  toRoleName: string;
  mcqCount: number;
  fillCount: number;
  mcqMinutes: number;
  fillMinutes: number;
  tenureDays: number;
};

type StateResp = {
  eligible: boolean;
  eligibilityReason: string | null;
  rolesUnavailable: boolean;
  tier: TierInfo | null;
  tenureDays: number | null;
  requiredDays: number | null;
  hasPassed: boolean;
  passedAttemptId: string | null;
  pendingReviewAttemptId: string | null;
  pendingReviewStats: { score: number | null; maxScore: number; passingScore: number } | null;
  attempt: {
    id: string;
    status: "in_progress" | "paused";
    currentSection: "mcq" | "fill" | "done";
    timerState: TimerState;
    answers: Record<string, string>;
  } | null;
  questions: PublicQuestion[];
};

const FILL_AUTOSAVE_MS = 450;

function enterFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  const w = el as unknown as { webkitRequestFullscreen?: () => Promise<void> };
  if (w.webkitRequestFullscreen) return w.webkitRequestFullscreen();
  return Promise.resolve();
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function PromoFooter() {
  const yr = new Date().getFullYear();
  return (
    <p className="mt-8 border-t border-white/[0.06] pt-5 text-[10px] leading-relaxed text-zinc-500">
      Unauthorized reproduction prohibited. Copyright © {yr} OpenSteam. All rights reserved.
    </p>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[820px] px-3 py-8 sm:px-4 sm:py-12">
      <div className="rounded-3xl border border-white/[0.08] bg-black/40 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <header className="mb-6">
          <p className="text-sm font-black tracking-tight text-white sm:text-base">{PROMO_BRAND.primaryLine}</p>
          <p className="mt-1 text-xs font-bold text-white sm:text-sm">{PROMO_BRAND.handbookLine}</p>
          <p className="mt-1 text-[10px] leading-snug text-zinc-400 sm:text-[11px]">{PROMO_BRAND.assessmentLine}</p>
          <div className="mt-4 h-px w-full bg-gradient-to-r from-white/20 via-white/10 to-transparent" aria-hidden />
        </header>
        {children}
      </div>
    </div>
  );
}

export default function PromoTestExam() {
  const { status: sessionStatus } = useSession();
  const [data, setData] = useState<StateResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<"signin" | "session_expired" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved">("idle");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const answersRef = useRef<Record<string, string>>({});
  const persistAbortRef = useRef<AbortController | null>(null);
  const fillDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const sectionRef = useRef<"mcq" | "fill" | "done">("mcq");
  const transitionRef = useRef<"advancing" | "submitting" | null>(null);

  const persistAnswers = useCallback(
    async (snapshot: Record<string, string>, mode: "autosave" | "finalize" = "autosave") => {
      const aid = attemptIdRef.current;
      if (!aid) return;
      if (mode === "finalize") {
        persistAbortRef.current?.abort();
        persistAbortRef.current = null;
        await new Promise((r) => setTimeout(r, 60));
      }
      let ctrl: AbortController | undefined;
      if (mode === "autosave") {
        persistAbortRef.current?.abort();
        ctrl = new AbortController();
        persistAbortRef.current = ctrl;
        setSaveHint("saving");
      }
      try {
        const res = await fetch("/api/promo-test/answers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: aid, answers: snapshot }),
          ...(ctrl?.signal ? { signal: ctrl.signal } : {}),
        });
        if (!res.ok && res.status !== 409) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(j.message ?? "Autosave failed");
        }
        if (mode === "autosave") setSaveHint("saved");
      } catch (e: unknown) {
        if (ctrl && (e instanceof DOMException || e instanceof Error) && e.name === "AbortError") {
          return;
        }
        if (mode === "autosave") setSaveHint("idle");
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    const res = await fetch("/api/promo-test", { cache: "no-store" });
    setLoading(false);
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      if (reason === "inactivity") return void signOut({ callbackUrl: "/?logout=inactivity" });
      if (reason === "guild_left") return void signOut({ callbackUrl: "/?logout=guild_left" });
      if (reason === "guild_banned") return void signOut({ callbackUrl: "/?logout=guild_banned" });
      if (reason === "oauth_expired") return void signOut({ callbackUrl: "/?logout=oauth_expired" });
      setData(null);
      setAuthError(sessionStatus === "authenticated" ? "session_expired" : "signin");
      return;
    }
    if (!res.ok) {
      setData(null);
      setErr("Could not load the promotion exam.");
      return;
    }
    const s = (await res.json()) as StateResp;
    setData(s);
    if (s.attempt?.id) {
      attemptIdRef.current = s.attempt.id;
      sectionRef.current = s.attempt.currentSection;
      const a = s.attempt.answers ?? {};
      answersRef.current = a;
      setAnswers(a);
    } else {
      attemptIdRef.current = null;
      sectionRef.current = "mcq";
      answersRef.current = {};
      setAnswers({});
    }
  }, [sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus === "unauthenticated") {
      setLoading(false);
      setAuthError("signin");
      return;
    }
    void refresh();
  }, [sessionStatus, refresh]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    return () => {
      if (fillDebounceRef.current) clearTimeout(fillDebounceRef.current);
      persistAbortRef.current?.abort();
    };
  }, []);

  const advanceSection = useCallback(async () => {
    const aid = attemptIdRef.current;
    if (!aid || transitionRef.current) return;
    transitionRef.current = "advancing";
    try {
      if (fillDebounceRef.current) clearTimeout(fillDebounceRef.current);
      await persistAnswers(answersRef.current, "finalize").catch(() => {});
      await fetch("/api/promo-test/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: aid }),
      });
      await refresh();
    } finally {
      transitionRef.current = null;
    }
  }, [persistAnswers, refresh]);

  const submit = useCallback(
    async (auto = false) => {
      const aid = attemptIdRef.current;
      if (!aid) return;
      if (!auto && transitionRef.current) return;
      transitionRef.current = "submitting";
      setSubmitting(true);
      setErr(null);
      try {
        if (fillDebounceRef.current) clearTimeout(fillDebounceRef.current);
        await persistAnswers(answersRef.current, "finalize").catch(() => {});
        const res = await fetch("/api/promo-test/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: aid }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(json.message ?? "Submit failed");
          return;
        }
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {});
        }
        await refresh();
      } finally {
        setSubmitting(false);
        transitionRef.current = null;
        setSaveHint("idle");
      }
    },
    [persistAnswers, refresh],
  );

  // 1s tick that also drives auto-advance / auto-submit when a section's deadline passes.
  useEffect(() => {
    const att = data?.attempt;
    if (!att || att.status !== "in_progress") return;
    const section = att.currentSection;
    if (section !== "mcq" && section !== "fill") return;
    const timer = att.timerState?.[section];
    if (!timer) return;
    const endsAt = new Date(timer.endsAt).getTime();

    const id = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= endsAt && !transitionRef.current) {
        if (section === "mcq") void advanceSection();
        else void submit(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [data, advanceSection, submit]);

  const onMcqPick = useCallback(
    (id: string, letter: string) => {
      setErr(null);
      setAnswers((prev) => {
        const next = { ...prev, [id]: letter };
        answersRef.current = next;
        if (fillDebounceRef.current) {
          clearTimeout(fillDebounceRef.current);
          fillDebounceRef.current = null;
        }
        void persistAnswers(next, "autosave");
        return next;
      });
    },
    [persistAnswers],
  );

  const onFillChange = useCallback(
    (id: string, value: string) => {
      setErr(null);
      setAnswers((prev) => {
        const next = { ...prev, [id]: value };
        answersRef.current = next;
        if (fillDebounceRef.current) clearTimeout(fillDebounceRef.current);
        fillDebounceRef.current = setTimeout(() => {
          fillDebounceRef.current = null;
          void persistAnswers(answersRef.current, "autosave");
        }, FILL_AUTOSAVE_MS);
        return next;
      });
    },
    [persistAnswers],
  );

  const startSession = async () => {
    if (starting) return;
    setStarting(true);
    setProgressText("Initializing AI…");
    setErr(null);
    try {
      const res = await fetch("/api/promo-test/start", { method: "POST" });
      const contentType = res.headers.get("Content-Type") || "";
      if (!res.ok && !contentType.includes("text/event-stream")) {
        const j = await res.json().catch(() => ({}));
        setErr(j.message ?? "Could not start");
        return;
      }
      if (contentType.includes("application/json")) {
        await res.json().catch(() => ({}));
        try {
          await enterFullscreen();
        } catch {}
        await refresh();
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const evt = JSON.parse(part.slice(6));
          if (evt.type === "progress") {
            setProgressText(`Drafting your exam… (${evt.collected}/${evt.total})`);
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          } else if (evt.type === "success") {
            try {
              await enterFullscreen();
            } catch {}
            await refresh();
          }
        }
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Network error. Please try again.");
    } finally {
      setStarting(false);
      setProgressText("");
    }
  };

  if ((loading || sessionStatus === "loading") && !data && !authError) {
    return (
      <Shell>
        <p className="text-sm text-zinc-400">Loading promotion exam…</p>
        <PromoFooter />
      </Shell>
    );
  }

  if (authError) {
    return (
      <Shell>
        <p className="mb-4 text-sm text-zinc-300">
          {authError === "signin"
            ? "Sign in with Discord to open your promotion exam."
            : "Your session expired. Sign in again to continue."}
        </p>
        <Link
          href="/auth/signin?callbackUrl=/dashboard/promo-test"
          className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-indigo-500"
        >
          Sign in with Discord
        </Link>
        <PromoFooter />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <p className="text-sm text-red-300/90">{err ?? "Could not load the promotion exam."}</p>
        <PromoFooter />
      </Shell>
    );
  }

  if (data.pendingReviewAttemptId) {
    const pid = data.pendingReviewAttemptId;
    const st = data.pendingReviewStats;
    const pct = (n: number, mx: number) => (mx > 0 ? ((n / mx) * 100).toFixed(1) : "0");
    return (
      <Shell>
        <p className="mb-5 inline-flex rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/95">
          Awaiting staff review
        </p>
        <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
          Your promotion exam was submitted. An admin must approve, reject, or re-grade before the outcome is final.
        </p>
        {st?.score != null ? (
          <p className="mb-6 text-sm font-semibold text-white">
            Draft score (not final): {st.score} / {st.maxScore} pts ({pct(st.score, st.maxScore)}%)
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href={`/api/promo-test/paper/${pid}?variant=record`} download className="inline-flex justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-sky-500">
            Download · your answers (PDF)
          </a>
          <a href={`/api/promo-test/paper/${pid}?variant=blank`} download className="inline-flex justify-center rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-white/10">
            Download · blank exam (PDF)
          </a>
        </div>
        <PromoFooter />
      </Shell>
    );
  }

  if (data.hasPassed && data.passedAttemptId) {
    const pid = data.passedAttemptId;
    return (
      <Shell>
        <p className="mb-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/95">
          Promotion passed
        </p>
        <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
          You passed{data.tier ? ` the ${data.tier.label}` : " your promotion exam"}. Keep a PDF copy below.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href={`/api/promo-test/paper/${pid}?variant=record`} download className="inline-flex justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-emerald-500">
            Download · your answers (PDF)
          </a>
          <a href={`/api/promo-test/paper/${pid}?variant=blank`} download className="inline-flex justify-center rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-white/10">
            Download · blank exam (PDF)
          </a>
        </div>
        <PromoFooter />
      </Shell>
    );
  }

  const att = data.attempt;

  if (att?.status === "paused") {
    return (
      <Shell>
        <p className="mb-4 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/95">
          Exam paused
        </p>
        <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
          The session was frozen (you left full screen / switched tabs). Note the section timer keeps running. Ask an admin to
          press <strong className="text-white">Resume</strong>, then reload.
        </p>
        <button type="button" className="rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10" onClick={() => window.location.reload()}>
          Reload after resume
        </button>
        <PromoFooter />
      </Shell>
    );
  }

  // Pre-start landing.
  if (!att) {
    const tier = data.tier;
    return (
      <Shell>
        {!data.eligible ? (
          <>
            <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Not available</p>
            <p className="text-[0.925rem] leading-relaxed text-zinc-400">
              {data.eligibilityReason ?? "You are not currently eligible for a promotion exam."}
            </p>
            {tier && data.requiredDays != null ? (
              <p className="mt-3 text-xs text-zinc-500">
                Tenure on {tier.fromRoleName}: <strong className="text-zinc-300">{Math.floor(data.tenureDays ?? 0)}</strong> /{" "}
                {data.requiredDays} days required.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mb-4 inline-flex rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/90">
              {tier?.label ?? "Promotion exam"}
            </p>
            <h2 className="mb-4 text-xl font-black tracking-tight text-white sm:text-[1.35rem]">
              {tier ? `${tier.fromRoleName} → ${tier.toRoleName}` : "Promotion exam"}
            </h2>
            {tier ? (
              <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-400">
                Two timed sections, generated fresh for you:
                <br />
                <br />
                <strong className="text-zinc-200">Section 1 — {tier.mcqCount} multiple choice (A–D)</strong>, {tier.mcqMinutes}{" "}
                minutes. A running timer is shown; when it ends, your answers lock and you advance automatically.
                <br />
                <strong className="text-zinc-200">Section 2 — {tier.fillCount} written answers</strong>, {tier.fillMinutes}{" "}
                minutes. When the timer ends, the exam submits automatically.
                <br />
                <br />
                Launches in full screen. Leaving full screen pauses the session (staff are alerted) but the timer keeps running.
                Submissions are AI-graded, then confirmed by staff.
              </p>
            ) : null}
            {err && <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</p>}
            <button
              type="button"
              onClick={startSession}
              disabled={starting}
              className="rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? progressText || "Starting…" : "Start exam (enters full screen)"}
            </button>
          </>
        )}
        <PromoFooter />
      </Shell>
    );
  }

  // Active exam — current section only.
  const section = att.currentSection === "fill" ? "fill" : "mcq";
  const sectionQs = data.questions.filter((q) => q.type === section);
  const timer = att.timerState?.[section];
  const remainingMs = timer ? new Date(timer.endsAt).getTime() - nowTick : 0;
  const lowTime = remainingMs <= 60_000;
  const tier = data.tier;

  return (
    <div className="relative min-h-[100dvh] px-4 py-7 sm:px-10 sm:py-12 pb-32">
      <div className="mx-auto w-full max-w-[820px]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black tracking-tight text-white">{PROMO_BRAND.handbookLine}</p>
            <p className="text-[11px] text-zinc-400">
              {tier ? `${tier.fromRoleName} → ${tier.toRoleName}` : ""} · Section {section === "mcq" ? "1" : "2"} of 2 ·{" "}
              {section === "mcq" ? "Multiple choice" : "Written answers"}
            </p>
          </div>
          <div
            className={`rounded-2xl border px-5 py-2 text-center font-mono text-2xl font-black tabular-nums ${
              lowTime
                ? "border-red-500/50 bg-red-500/10 text-red-300 animate-pulse"
                : "border-indigo-500/30 bg-indigo-500/10 text-indigo-200"
            }`}
            aria-live="polite"
          >
            {fmtClock(remainingMs)}
            <span className="ml-2 block text-[9px] font-bold uppercase tracking-widest text-zinc-400 sm:inline">
              time left
            </span>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-500" aria-live="polite">
            {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved ✓" : null}
          </p>
          <div className="flex items-center gap-3">
            <a href={`/api/promo-test/paper/${att.id}?variant=blank`} download className="text-[11px] font-semibold uppercase tracking-widest text-sky-300 no-underline hover:text-sky-200">
              Blank paper PDF
            </a>
            <button
              type="button"
              onClick={() => enterFullscreen().catch(() => {})}
              className="rounded-full border border-white/15 bg-black/35 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/90 hover:bg-white/[0.08]"
            >
              Full screen
            </button>
          </div>
        </div>

        {err && <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</p>}

        <div className="flex flex-col gap-6">
          {sectionQs.map((q, idx) => (
            <div key={q.id} className="rounded-2xl border border-white/[0.08] bg-black/30 p-5 sm:p-6">
              <div className="mb-5 flex gap-4 text-[0.95rem] font-semibold leading-relaxed text-zinc-100">
                <span className="flex h-9 min-w-[2.25rem] shrink-0 items-center justify-center rounded-xl bg-white/[0.07] font-mono text-sm font-black text-indigo-300">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 pt-0.5">{q.prompt}</span>
              </div>
              {q.type === "mcq" ? (
                <div role="radiogroup" className="flex flex-col gap-2.5">
                  {(["A", "B", "C", "D"] as const).map((key) => {
                    const selected = (answers[q.id] ?? "").toUpperCase() === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={submitting}
                        onClick={() => onMcqPick(q.id, key)}
                        className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-[0.9rem] leading-relaxed transition-all ${
                          selected
                            ? "border-indigo-400/80 bg-indigo-600/20 text-white"
                            : "border-white/[0.08] bg-black/30 text-zinc-200 hover:border-white/15 hover:bg-white/[0.04]"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0 font-mono text-xs font-black text-indigo-300">{key}.</span>
                        <span>{q.choices[key]}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) => onFillChange(q.id, e.target.value)}
                  disabled={submitting}
                  rows={5}
                  className="w-full resize-y rounded-xl border border-white/10 bg-black/45 px-4 py-3 text-[0.9rem] text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-indigo-400/40"
                  placeholder="Type your answer…"
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          {section === "mcq" ? (
            <button
              type="button"
              disabled={!!transitionRef.current}
              onClick={() => void advanceSection()}
              className="rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-8 py-3.5 font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-55"
            >
              Finish Section 1 → go to written answers
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(false)}
              className="rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-8 py-3.5 font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-55"
            >
              {submitting ? "Submitting…" : "Submit exam for AI draft + staff review"}
            </button>
          )}
        </div>
        <p className="mt-10 text-[10px] leading-relaxed text-zinc-600">
          Once a section&apos;s timer ends it locks automatically. Copyright © {new Date().getFullYear()} OpenSteam. All rights reserved.
        </p>
      </div>
    </div>
  );
}
