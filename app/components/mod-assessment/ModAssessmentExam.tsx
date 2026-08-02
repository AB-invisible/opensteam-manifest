"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import type { PublicQuestion } from "@/app/lib/mod-assessment-public";
import { REALTIME_FILL_COUNT, REALTIME_MCQ_COUNT } from "@/app/lib/mod-assessment-exam-realtime";
import ModAssessmentBrandedHeader from "@/app/components/mod-assessment/ModAssessmentBrandedHeader";
import ModAssessmentLandingChrome from "@/app/components/mod-assessment/ModAssessmentLandingChrome";

function suppressBackgroundPersistReject(reason: unknown) {
  if (reason instanceof Error && reason.name === "AbortError") return;
  console.error("[mod-assessment]", reason);
}

type StateResp = {
  eligible: boolean;
  eligibilityReason: string | null;
  /** After staff approval — downloadable record PDF id */
  hasPassedLive?: boolean;
  passedAttemptId?: string | null;
  assessment: { id: string; title: string; questions: PublicQuestion[] };
  attempt: { id: string; status: string; answers: Record<string, string> } | null;
  pendingManualReviewAttemptId?: string | null;
  pendingReviewStats?: {
    score: number | null;
    maxScore: number;
    passingScore: number;
  } | null;
};

function ModAssessmentFooterNote() {
  const yr = new Date().getFullYear();
  return (
    <p className="mt-8 border-t border-white/[0.06] pt-5 text-[10px] leading-relaxed text-zinc-500">
      Unauthorized reproduction prohibited. Copyright © {yr} OpenSteam. All rights reserved.
    </p>
  );
}

type FetchStateResult =
  | { ok: true; data: StateResp }
  | { ok: false; status: number; reason?: string };

async function fetchState(): Promise<FetchStateResult> {
  const res = await fetch("/api/mod-assessment", { cache: "no-store" });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, status: 401, reason: typeof body.reason === "string" ? body.reason : undefined };
  }
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: await res.json() };
}

function enterFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  const w = el as unknown as { webkitRequestFullscreen?: () => Promise<void> };
  if (w.webkitRequestFullscreen) return w.webkitRequestFullscreen();
  return Promise.resolve();
}

const FILL_AUTOSAVE_MS = 450;

export default function ModAssessmentExam() {
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

  /** Authoritative snapshot for submit + autosave races (always updated with `answers`). */
  const answersRef = useRef<Record<string, string>>({});
  const persistAbortRef = useRef<AbortController | null>(null);
  const fillDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHintClearRef = useRef<number | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const hadFullscreenRef = useRef(false);

  /**
   * `autosave` — cancels overlapping PATCH so only the newest snapshot wins (prevents stale completion wiping newer choices).
   * `finalize` — used right before Submit; never aborts, so Submit always merges the full payload into the DB.
   */
  const persistAnswers = useCallback(
    async (snapshot: Record<string, string>, mode: "autosave" | "finalize" = "autosave") => {
      const aid = attemptIdRef.current;
      if (!aid) return;

      if (mode === "finalize") {
        persistAbortRef.current?.abort();
        persistAbortRef.current = null;
        await new Promise((r) => setTimeout(r, 80));
      }

      let ctrl: AbortController | undefined;
      if (mode === "autosave") {
        persistAbortRef.current?.abort();
        ctrl = new AbortController();
        persistAbortRef.current = ctrl;
        setSaveHint("saving");
      }

      try {
        const res = await fetch("/api/mod-assessment/answers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: aid, answers: snapshot }),
          ...(ctrl?.signal ? { signal: ctrl.signal } : {}),
        });

        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          if (res.status === 409 && j.message) setErr(j.message);
          const msg = j.message ?? res.statusText;
          throw new Error(msg || "Autosave failed");
        }

        if (mode === "autosave") {
          setSaveHint("saved");
          if (savedHintClearRef.current != null) window.clearTimeout(savedHintClearRef.current);
          savedHintClearRef.current = window.setTimeout(() => {
            savedHintClearRef.current = null;
            setSaveHint("idle");
          }, 1100);
        }
      } catch (e: unknown) {
        if (
          ctrl &&
          (e instanceof DOMException || e instanceof Error) &&
          e.name === "AbortError"
        ) {
          setSaveHint((h) => (h === "saving" ? "idle" : h));
          return;
        }
        console.error("[mod-assessment] persist", e);
        if (mode === "autosave") setSaveHint("idle");
        throw e;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    const result = await fetchState();
    setLoading(false);

    if (!result.ok) {
      setData(null);
      if (result.status === 401) {
        if (result.reason === "inactivity") {
          void signOut({ callbackUrl: "/?logout=inactivity" });
          return null;
        }
        if (result.reason === "guild_left") {
          void signOut({ callbackUrl: "/?logout=guild_left" });
          return null;
        }
        if (result.reason === "guild_banned") {
          void signOut({ callbackUrl: "/?logout=guild_banned" });
          return null;
        }
        if (result.reason === "oauth_expired") {
          void signOut({ callbackUrl: "/?logout=oauth_expired" });
          return null;
        }
        setAuthError(sessionStatus === "authenticated" ? "session_expired" : "signin");
        return null;
      }
      setErr("Could not load assessment.");
      return null;
    }

    const s = result.data;
    setData(s);
    if (s.attempt?.id) {
      attemptIdRef.current = s.attempt.id;
      const a = s.attempt.answers ?? {};
      answersRef.current = a;
      setAnswers(a);
    } else {
      attemptIdRef.current = null;
      answersRef.current = {};
      setAnswers({});
    }
    return s;
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
      if (savedHintClearRef.current != null) window.clearTimeout(savedHintClearRef.current);
      persistAbortRef.current?.abort();
    };
  }, []);

  /** Choice tap: save immediately — overwrites prior letter for same question id. */
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
        void persistAnswers(next, "autosave").catch(suppressBackgroundPersistReject);
        return next;
      });
    },
    [persistAnswers],
  );

  /** Typed answers: debounced — batches keystrokes then sends full snapshot so nothing is dropped. */
  const onFillChange = useCallback(
    (id: string, value: string) => {
      setErr(null);
      setAnswers((prev) => {
        const next = { ...prev, [id]: value };
        answersRef.current = next;
        if (fillDebounceRef.current) clearTimeout(fillDebounceRef.current);
        fillDebounceRef.current = setTimeout(() => {
          fillDebounceRef.current = null;
          void persistAnswers(answersRef.current, "autosave").catch(suppressBackgroundPersistReject);
        }, FILL_AUTOSAVE_MS);
        return next;
      });
    },
    [persistAnswers],
  );

  const signalPause = useCallback(
    async (reason: string) => {
      const aid = attemptIdRef.current;
      if (!aid) return;
      const before = attemptIdRef.current;
      await fetch("/api/mod-assessment/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: aid, reason }),
      });
      await refresh();
      attemptIdRef.current = before;
    },
    [refresh],
  );

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && attemptIdRef.current) {
        void signalPause("tab_hidden");
      }
    };
    const onFs = () => {
      if (document.fullscreenElement) hadFullscreenRef.current = true;
      if (!document.fullscreenElement && hadFullscreenRef.current && attemptIdRef.current) {
        void signalPause("fullscreen_exit");
      }
    };

    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [signalPause]);

  const startSession = async () => {
    if (starting) return;
    setStarting(true);
    setProgressText("Initializing AI...");
    setErr(null);
    try {
      const res = await fetch("/api/mod-assessment/start", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.message ?? "Could not start");
        setStarting(false);
        return;
      }

      const contentType = res.headers.get("Content-Type") || "";
      if (!contentType.includes("text/event-stream") && contentType.includes("application/json")) {
        const j = await res.json();
        attemptIdRef.current = j.attemptId;
        hadFullscreenRef.current = false;
        try {
          await enterFullscreen();
          hadFullscreenRef.current = !!document.fullscreenElement;
        } catch {
          /* fullscreen denied */
        }
        await refresh();
        setStarting(false);
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
          if (part.startsWith("data: ")) {
            try {
              const data = JSON.parse(part.slice(6));
              if (data.type === "progress") {
                setProgressText(`Drafting unique questions... (${data.collected}/${data.total})`);
              } else if (data.type === "error") {
                throw new Error(data.message);
              } else if (data.type === "success") {
                attemptIdRef.current = data.attemptId;
                hadFullscreenRef.current = false;
                try {
                  await enterFullscreen();
                  hadFullscreenRef.current = !!document.fullscreenElement;
                } catch {}
                await refresh();
              }
            } catch (err: any) {
              if (err.name === "Error") throw err;
            }
          }
        }
      }
    } catch (e: any) {
      setErr(e.message || "Network error. Please try again.");
    } finally {
      setStarting(false);
      setProgressText("");
    }
  };

  const submit = async () => {
    const aid = attemptIdRef.current;
    if (!aid) return;
    setSubmitting(true);
    setErr(null);
    try {
      if (fillDebounceRef.current) {
        clearTimeout(fillDebounceRef.current);
        fillDebounceRef.current = null;
      }
      const latest = answersRef.current;
      try {
        await persistAnswers(latest, "finalize");
      } catch {
        setErr("Could not sync answers to the server. Check your connection and try submit again.");
        return;
      }

      const res = await fetch("/api/mod-assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: aid }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.message ?? "Submit failed");
        if (Array.isArray(json.missing) && json.missing.length) {
          setErr(`${json.message ?? "Incomplete"} (${json.missing.length} unanswered)`);
        }
        return;
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      }
      await refresh();
    } finally {
      setSubmitting(false);
      setSaveHint("idle");
    }
  };

  if ((loading || sessionStatus === "loading") && !data && !authError) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-8 sm:px-4 sm:py-12">
        <ModAssessmentLandingChrome innerClassName="p-6 sm:p-8">
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="text-sm text-zinc-400">Loading assessment…</p>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (authError === "signin") {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-8 sm:px-4 sm:py-12">
        <ModAssessmentLandingChrome innerClassName="p-6 sm:p-8">
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-4 text-sm text-zinc-300">
            Sign in with Discord to open your moderator assessment.
          </p>
          <Link
            href="/auth/signin?callbackUrl=/dashboard/mod-assessment"
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow hover:bg-indigo-500"
          >
            Sign in with Discord
          </Link>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (authError === "session_expired") {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-8 sm:px-4 sm:py-12">
        <ModAssessmentLandingChrome innerClassName="p-6 sm:p-8">
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-4 text-sm text-zinc-300">
            Your session expired. Sign in again to continue the assessment.
          </p>
          <Link
            href="/auth/signin?callbackUrl=/dashboard/mod-assessment"
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow hover:bg-indigo-500"
          >
            Sign in again
          </Link>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-8 sm:px-4 sm:py-12">
        <ModAssessmentLandingChrome innerClassName="p-6 sm:p-8">
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="text-sm text-red-300/90">{err ?? "Could not load assessment."}</p>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (data.pendingManualReviewAttemptId) {
    const pid = data.pendingManualReviewAttemptId;
    const st = data.pendingReviewStats;
    const pct = (n: number, mx: number) => (mx > 0 ? ((n / mx) * 100).toFixed(1) : "0");
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-6 sm:px-4 sm:py-10">
        <ModAssessmentLandingChrome
          innerClassName="p-6 sm:p-8"
          className="border-amber-500/15 ring-1 ring-amber-500/10"
        >
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-5 inline-flex rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/95">
            Awaiting staff review
          </p>
          <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
            Your answers were submitted. The AI drafts a provisional score — an admin still must{" "}
            <strong className="text-white">approve</strong>, <strong className="text-white">reject</strong>, or{" "}
            <strong className="text-white">re-grade</strong> before the outcome is final.
          </p>
          {st ? (
            <div className="mb-6 rounded-2xl border border-white/[0.08] bg-black/35 px-4 py-3 backdrop-blur-sm">
              {st.score != null ? (
                <p className="text-sm font-semibold text-white">
                  Draft score (not final): {st.score} / {st.maxScore} pts ({pct(st.score, st.maxScore)}%)
                </p>
              ) : (
                <p className="text-sm font-medium text-zinc-300">Draft score pending — AI or staff grading in progress.</p>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Passing threshold on this exam: {st.passingScore} pts ({pct(st.passingScore, st.maxScore)}% of points).
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <a
              href={`/api/mod-assessment/paper/${pid}?variant=record`}
              className="inline-flex justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow hover:bg-sky-500"
              download
            >
              Download · your answers (PDF)
            </a>
            <a
              href={`/api/mod-assessment/paper/${pid}?variant=blank`}
              className="inline-flex justify-center rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-white/10"
              download
            >
              Download · blank exam (PDF)
            </a>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
            Answer PDF includes your submissions and provisional outcome lines; staff decision remains authoritative.
          </p>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (data.hasPassedLive && data.passedAttemptId) {
    const pid = data.passedAttemptId;
    const base = `/api/mod-assessment/paper/${pid}`;
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-6 sm:px-4 sm:py-10">
        <ModAssessmentLandingChrome
          innerClassName="p-6 sm:p-8"
          className="border-emerald-500/25 ring-1 ring-emerald-500/15"
        >
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/95">
            Assessment passed
          </p>
          <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
            You passed the live moderator exam. Keep a PDF of your question paper or your answered paper below — downloads open in
            your browser.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <a
              href={`${base}?variant=record`}
              className="inline-flex justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white no-underline shadow hover:bg-emerald-500"
              download
            >
              Download · your answers (PDF)
            </a>
            <a
              href={`${base}?variant=blank`}
              className="inline-flex justify-center rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-white/10"
              download
            >
              Download · blank exam (PDF)
            </a>
          </div>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (!data.eligible) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-6 sm:px-4 sm:py-10">
        <ModAssessmentLandingChrome innerClassName="p-6 sm:p-8">
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-500">Not available</p>
          <p className="text-[0.925rem] leading-relaxed text-zinc-400">{data.eligibilityReason ?? "Not available."}</p>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  const att = data.attempt;

  if (att?.status === "paused") {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-6 sm:px-4 sm:py-10">
        <ModAssessmentLandingChrome
          innerClassName="p-6 sm:p-8"
          className="border-amber-500/20 ring-1 ring-amber-500/10"
        >
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-4 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/95">
            Assessment paused
          </p>
          <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
            The session was frozen (tab switch / left full screen). Ask an admin or owner to press{" "}
            <strong className="text-white">Resume</strong> in Admin, then reload this page.
          </p>
          <button
            type="button"
            className="rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            Reload after resume
          </button>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  if (!att) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-3 py-6 sm:px-4 sm:py-10">
        <ModAssessmentLandingChrome innerClassName="p-6 sm:p-8">
          <ModAssessmentBrandedHeader className="mb-6" />
          <p className="mb-4 inline-flex rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/90">
            Before you start
          </p>
          <h2 className="mb-4 text-xl font-black tracking-tight text-white sm:text-[1.35rem]">
            <span className="bg-gradient-to-br from-white via-indigo-100 to-violet-300/95 bg-clip-text text-transparent">
              {data.assessment.title}
            </span>
          </h2>
          <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-400">
            When you start, the app builds your paper <strong className="text-zinc-200">in real time</strong> from Trial Mod Test–style
            pools (~<strong className="text-zinc-200">{REALTIME_MCQ_COUNT}</strong> multiple choice plus{" "}
            <strong className="text-zinc-200">{REALTIME_FILL_COUNT}</strong> written tickets). Topics focus on Discord moderation and
            support — not random application trivia. Questions differ per attempt.
            <br />
            <br />
            The UI launches in <strong className="text-zinc-200">full screen</strong>. Leaving full screen or switching away{" "}
            <strong className="text-zinc-200">pauses</strong> the exam — staff get an alert and must{" "}
            <strong className="text-zinc-200">resume</strong> you from Admin.
          </p>
          {err && <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</p>}
          <button
            type="button"
            onClick={startSession}
            disabled={starting}
            className="rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-6 py-3 text-sm font-bold text-white shadow-[0_12px_40px_-12px_rgba(99,102,241,0.55)] transition-transform hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting ? (progressText || "Starting...") : "Start (creates attempt & enters full screen)"}
          </button>
          <ModAssessmentFooterNote />
        </ModAssessmentLandingChrome>
      </div>
    );
  }

  const qs = data.assessment.questions;

  return (
    <div className="mod-assessment-shell">
      <div className="mod-assessment-shell__ambient" aria-hidden />
      <div className="mod-assessment-shell__grid" aria-hidden />
      <div className="mod-assessment-shell__scan" aria-hidden />

      <div className="relative z-10 flex min-h-[100dvh] flex-col px-4 py-7 sm:px-10 sm:py-12 pb-32">
        <div className="mx-auto mb-8 w-full max-w-[760px] shrink-0 px-1">
          <ModAssessmentBrandedHeader compact />
        </div>
        <div className="mx-auto mb-8 flex max-w-[760px] w-full shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-500" aria-live="polite">
              {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved ✓" : null}
            </p>
            {data.attempt?.id ? (
              <a
                href={`/api/mod-assessment/paper/${data.attempt.id}?variant=blank`}
                className="text-[11px] font-semibold uppercase tracking-widest text-sky-300 no-underline hover:text-sky-200"
                download
              >
                Blank paper PDF
              </a>
            ) : null}
          </div>
          <button
            type="button"
            disabled={submitting}
            className="rounded-full border border-white/15 bg-black/35 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-colors hover:bg-white/[0.08] hover:border-white/25 disabled:pointer-events-none disabled:opacity-40"
            onClick={() =>
              enterFullscreen()
                .then(() => {
                  hadFullscreenRef.current = !!document.fullscreenElement;
                })
                .catch(() => {})
            }
          >
            Full screen
          </button>
        </div>

        <div className="mx-auto w-full max-w-[760px] flex-1">
          <header className="mb-10">
            <p className="mb-3 inline-flex rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/90">
              Live moderator exam
            </p>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-[1.75rem]">
              <span className="bg-gradient-to-br from-white via-indigo-100 to-violet-300/95 bg-clip-text text-transparent">
                {data.assessment.title}
              </span>
            </h1>
            <p className="mt-4 max-w-lg text-[0.875rem] leading-relaxed text-zinc-400">
              <span className="text-emerald-400">● </span>
              {qs.length} questions · moderation & tickets · MCQ saves instantly, written prompts autosave shortly after typing
              {" — "}keep this tab focused until submit.
            </p>
          </header>

          {err && <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</p>}

          <div className="flex flex-col gap-7">
            {qs.map((q, idx) => (
              <div key={q.id} className="mod-assessment-panel p-6 sm:p-7">
                <div className="mb-6 flex gap-4 text-[0.95rem] font-semibold leading-relaxed tracking-tight text-zinc-100">
                  <span className="flex h-9 min-w-[2.25rem] shrink-0 items-center justify-center rounded-xl bg-white/[0.07] font-mono text-sm font-black text-primary">
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">{q.prompt}</span>
                </div>
                {q.type === "mcq" ? (
                  <div
                    role="radiogroup"
                    aria-label={`Question ${idx + 1}: choose A, B, C, or D`}
                    className="flex flex-col gap-2.5"
                  >
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
                          className={`flex w-full touch-manipulation items-start gap-3 rounded-xl border px-4 py-3 text-left text-[0.9rem] leading-relaxed tracking-tight transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 ${
                            selected
                              ? "border-primary/80 bg-gradient-to-br from-primary/25 to-indigo-600/15 text-white shadow-[0_0_32px_-8px_rgba(139,92,246,0.45)]"
                              : "border-white/[0.08] bg-black/30 text-zinc-200 hover:border-white/15 hover:bg-white/[0.04]"
                          }`}
                        >
                          <span className="mt-0.5 shrink-0 font-mono text-xs font-black text-primary">{key}.</span>
                          <span className={selected ? "text-white" : ""}>{q.choices[key]}</span>
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
                    className="w-full resize-y rounded-xl border border-white/10 bg-black/45 px-4 py-3 text-[0.9rem] text-zinc-100 placeholder:text-zinc-600 shadow-inner outline-none ring-0 transition-[border,box-shadow] focus:border-primary/40 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.15)] disabled:pointer-events-none disabled:opacity-55"
                    placeholder="Type your answer…"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-8 py-3.5 font-bold text-white shadow-[0_12px_40px_-12px_rgba(16,185,129,0.55)] transition-transform hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 sm:text-[0.95rem]"
            >
              {submitting ? "Submitting…" : "Submit for AI draft + manual review"}
            </button>
          </div>
          <p className="mt-12 text-[10px] leading-relaxed text-zinc-600">
            Unauthorized reproduction prohibited. Copyright © {new Date().getFullYear()} OpenSteam. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
