"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { EXEC_BRAND } from "@/app/lib/exec-brand";

type PublicQuestion =
  | { id: string; type: "mcq"; prompt: string; choices: { A: string; B: string; C: string; D: string }; category?: string; categoryLabel?: string }
  | { id: string; type: "fill"; prompt: string; category?: string; categoryLabel?: string };

type ExecTimer = { startedAt: string; endsAt: string };
type TimerState = { exam?: ExecTimer };

type TierInfo = {
  examKind: string;
  label: string;
  fromRoleName: string;
  toRoleName: string;
  mcqCount: number;
  fillCount: number;
  totalCount: number;
  examMinutes: number;
  tenureDays: number;
};

type ResultStats = {
  score: number | null;
  maxScore: number;
  passingScore: number;
  englishLevel: string | null;
};

type CategoryInfo = {
  id: string;
  label: string;
  description: string;
  mcqCount: number;
  writtenCount: number;
  difficulty: string;
  isFit: boolean;
};

type CategoryProgressEntry = {
  categoryId: string;
  appliedDifficulty: string;
  pct: number;
  handledLevel: string;
};

type StateResp = {
  eligible: boolean;
  eligibilityReason: string | null;
  rolesUnavailable: boolean;
  categories: CategoryInfo[];
  tier: TierInfo;
  tenureDays: number | null;
  requiredDays: number;
  hasPassed: boolean;
  passedAttemptId: string | null;
  pendingReviewAttemptId: string | null;
  resultStats: ResultStats | null;
  attempt: {
    id: string;
    status: "in_progress" | "paused";
    timerState: TimerState;
    currentCategory: string;
    categoryProgress: { currentCategoryId: string; completed: CategoryProgressEntry[] } | null;
    answers: Record<string, string>;
  } | null;
  questions: PublicQuestion[];
};

const AUTOSAVE_MS = 900;
const TYPING_IDLE_MS = 5000; // gaps longer than this are "thinking", not active typing

type QTyping = {
  chars: number;
  keystrokes: number;
  backspaces: number;
  activeMs: number;
  firstKeyLatencyMs: number | null;
  lastKeyTs: number | null;
  focusTs: number | null;
};

function groupQuestionsByCategory(questions: PublicQuestion[]) {
  const groups: { key: string; label: string; items: PublicQuestion[] }[] = [];
  for (const q of questions) {
    const key = q.category ?? "general";
    const label = q.categoryLabel ?? "Exam";
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(q);
    else groups.push({ key, label, items: [q] });
  }
  return groups;
}

function newQTyping(): QTyping {
  return { chars: 0, keystrokes: 0, backspaces: 0, activeMs: 0, firstKeyLatencyMs: null, lastKeyTs: null, focusTs: null };
}

function enterFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  const w = el as unknown as { webkitRequestFullscreen?: () => Promise<void> };
  if (w.webkitRequestFullscreen) return w.webkitRequestFullscreen();
  return Promise.resolve();
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ExecFooter() {
  return (
    <p className="mt-8 border-t border-white/[0.06] pt-5 text-[10px] leading-relaxed text-zinc-500">
      Unauthorized reproduction prohibited. Copyright © {new Date().getFullYear()} OpenSteam. All rights reserved.
    </p>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[820px] px-3 py-8 sm:px-4 sm:py-12">
      <div className="rounded-3xl border border-white/[0.08] bg-black/40 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <header className="mb-6">
          <p className="text-sm font-black tracking-tight text-white sm:text-base">{EXEC_BRAND.primaryLine}</p>
          <p className="mt-1 text-xs font-bold text-white sm:text-sm">{EXEC_BRAND.handbookLine}</p>
          <p className="mt-1 text-[10px] leading-snug text-zinc-400 sm:text-[11px]">{EXEC_BRAND.assessmentLine}</p>
          <div className="mt-4 h-px w-full bg-gradient-to-r from-white/20 via-white/10 to-transparent" aria-hidden />
        </header>
        {children}
      </div>
    </div>
  );
}

export default function ExecutiveTestExam() {
  const { status: sessionStatus } = useSession();
  const [data, setData] = useState<StateResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<"signin" | "session_expired" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved">("idle");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const answersRef = useRef<Record<string, string>>({});
  const typingRef = useRef<Record<string, QTyping>>({});
  const persistAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const transitionRef = useRef<"submitting" | "advancing" | null>(null);

  const typingSnapshot = useCallback((): { perQuestion: Record<string, Omit<QTyping, "lastKeyTs" | "focusTs">> } => {
    const perQuestion: Record<string, Omit<QTyping, "lastKeyTs" | "focusTs">> = {};
    for (const [id, t] of Object.entries(typingRef.current)) {
      perQuestion[id] = {
        chars: t.chars,
        keystrokes: t.keystrokes,
        backspaces: t.backspaces,
        activeMs: t.activeMs,
        firstKeyLatencyMs: t.firstKeyLatencyMs,
      };
    }
    return { perQuestion };
  }, []);

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
        const res = await fetch("/api/executive-test/answers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: aid, answers: snapshot, typing: typingSnapshot() }),
          ...(ctrl?.signal ? { signal: ctrl.signal } : {}),
        });
        if (!res.ok && res.status !== 409) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(j.message ?? "Autosave failed");
        }
        if (mode === "autosave") setSaveHint("saved");
      } catch (e: unknown) {
        if (ctrl && (e instanceof DOMException || e instanceof Error) && e.name === "AbortError") return;
        if (mode === "autosave") setSaveHint("idle");
      }
    },
    [typingSnapshot],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    const res = await fetch("/api/executive-test", { cache: "no-store" });
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
      setErr("Could not load the Executive Officer exam.");
      return;
    }
    const s = (await res.json()) as StateResp;
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
      if (debounceRef.current) clearTimeout(debounceRef.current);
      persistAbortRef.current?.abort();
    };
  }, []);

  const advanceCategory = useCallback(async () => {
    const aid = attemptIdRef.current;
    if (!aid || transitionRef.current) return;
    transitionRef.current = "advancing";
    setAdvancing(true);
    setErr(null);
    try {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      await persistAnswers(answersRef.current, "finalize").catch(() => {});
      const res = await fetch("/api/executive-test/advance-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: aid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json.message ?? "Could not advance to next category");
        return;
      }
      if (json.previousCategory?.handledLevel) {
        setProgressText(
          `${json.previousCategory.label}: ${json.previousCategory.pct}% — next block at ${json.currentCategory?.difficulty ?? "adapted"} tier`,
        );
      }
      await refresh();
    } finally {
      setAdvancing(false);
      transitionRef.current = null;
      setTimeout(() => setProgressText(""), 4000);
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
        if (debounceRef.current) clearTimeout(debounceRef.current);
        await persistAnswers(answersRef.current, "finalize").catch(() => {});
        const res = await fetch("/api/executive-test/submit", {
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

  // 1s tick that auto-submits when the single overall timer expires.
  useEffect(() => {
    const att = data?.attempt;
    if (!att || att.status !== "in_progress") return;
    const timer = att.timerState?.exam;
    if (!timer) return;
    const endsAt = new Date(timer.endsAt).getTime();
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (now >= endsAt && !transitionRef.current) void submit(true);
    }, 1000);
    return () => window.clearInterval(id);
  }, [data, submit]);

  // Pause on tab hidden / fullscreen exit (timer keeps running server-side).
  useEffect(() => {
    const att = data?.attempt;
    if (!att || att.status !== "in_progress") return;
    const aid = att.id;
    const pause = (reason: string) => {
      void fetch("/api/executive-test/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: aid, reason }),
        keepalive: true,
      }).then(() => refresh());
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") pause("tab_hidden");
    };
    const onFs = () => {
      if (!document.fullscreenElement) pause("fullscreen_exit");
    };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [data, refresh]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void persistAnswers(answersRef.current, "autosave");
    }, AUTOSAVE_MS);
  }, [persistAnswers]);

  const onMcqPick = useCallback(
    (id: string, letter: string) => {
      setErr(null);
      setAnswers((prev) => {
        const next = { ...prev, [id]: letter };
        answersRef.current = next;
        void persistAnswers(next, "autosave");
        return next;
      });
    },
    [persistAnswers],
  );

  const onFillFocus = useCallback((id: string) => {
    const t = (typingRef.current[id] ??= newQTyping());
    if (t.firstKeyLatencyMs == null && t.focusTs == null) t.focusTs = Date.now();
  }, []);

  const onFillKeyDown = useCallback((id: string, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const now = Date.now();
    const t = (typingRef.current[id] ??= newQTyping());
    // Count only character-producing keys + edits, not modifiers/navigation.
    const k = e.key;
    const isEdit = k === "Backspace" || k === "Delete";
    const isChar = k.length === 1 || k === "Enter" || isEdit;
    if (!isChar) return;
    if (t.firstKeyLatencyMs == null) {
      t.firstKeyLatencyMs = t.focusTs != null ? Math.max(0, now - t.focusTs) : 0;
    }
    t.keystrokes += 1;
    if (isEdit) t.backspaces += 1;
    if (t.lastKeyTs != null) {
      const gap = now - t.lastKeyTs;
      if (gap > 0 && gap < TYPING_IDLE_MS) t.activeMs += gap;
    }
    t.lastKeyTs = now;
  }, []);

  const onFillChange = useCallback(
    (id: string, value: string) => {
      setErr(null);
      const t = (typingRef.current[id] ??= newQTyping());
      t.chars = value.length;
      setAnswers((prev) => {
        const next = { ...prev, [id]: value };
        answersRef.current = next;
        scheduleSave();
        return next;
      });
    },
    [scheduleSave],
  );

  const startSession = async () => {
    if (starting) return;
    setStarting(true);
    setProgressText("Initializing AI…");
    setErr(null);
    try {
      const res = await fetch("/api/executive-test/start", { method: "POST" });
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
        <p className="text-sm text-zinc-400">Loading Executive Officer exam…</p>
        <ExecFooter />
      </Shell>
    );
  }

  if (authError) {
    return (
      <Shell>
        <p className="mb-4 text-sm text-zinc-300">
          {authError === "signin"
            ? "Sign in with Discord to open your Executive Officer exam."
            : "Your session expired. Sign in again to continue."}
        </p>
        <Link
          href="/auth/signin?callbackUrl=/dashboard/executive-test"
          className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-indigo-500"
        >
          Sign in with Discord
        </Link>
        <ExecFooter />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <p className="text-sm text-red-300/90">{err ?? "Could not load the Executive Officer exam."}</p>
        <ExecFooter />
      </Shell>
    );
  }

  const pct = (n: number, mx: number) => (mx > 0 ? ((n / mx) * 100).toFixed(1) : "0");

  if (data.pendingReviewAttemptId) {
    const pid = data.pendingReviewAttemptId;
    const st = data.resultStats;
    return (
      <Shell>
        <p className="mb-5 inline-flex rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/95">
          Awaiting staff review
        </p>
        <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-300">
          Your Executive Officer exam was submitted and auto-graded. An admin must approve, reject, or re-grade before the
          outcome is final.
        </p>
        {st?.score != null ? (
          <p className="mb-2 text-sm font-semibold text-white">
            Draft score (not final): {st.score} / {st.maxScore} pts ({pct(st.score, st.maxScore)}%)
          </p>
        ) : null}
        {st?.englishLevel ? (
          <p className="mb-6 text-sm font-semibold text-indigo-200">
            Estimated English level: <span className="font-black">{st.englishLevel}</span> (CEFR)
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href={`/api/executive-test/paper/${pid}?variant=record`} download className="inline-flex justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-sky-500">
            Download · your answers (PDF)
          </a>
          <a href={`/api/executive-test/paper/${pid}?variant=blank`} download className="inline-flex justify-center rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-white/10">
            Download · blank exam (PDF)
          </a>
        </div>
        <ExecFooter />
      </Shell>
    );
  }

  if (data.hasPassed && data.passedAttemptId) {
    const pid = data.passedAttemptId;
    const st = data.resultStats;
    return (
      <Shell>
        <p className="mb-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/95">
          Exam passed
        </p>
        <p className="mb-4 text-[0.925rem] leading-relaxed text-zinc-300">
          You passed the {data.tier.label}. Welcome to the Executive Officer team. Keep a PDF copy below.
        </p>
        {st?.englishLevel ? (
          <p className="mb-6 text-sm font-semibold text-indigo-200">
            Estimated English level: <span className="font-black">{st.englishLevel}</span> (CEFR)
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <a href={`/api/executive-test/paper/${pid}?variant=record`} download className="inline-flex justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white no-underline hover:bg-emerald-500">
            Download · your answers (PDF)
          </a>
          <a href={`/api/executive-test/paper/${pid}?variant=blank`} download className="inline-flex justify-center rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white no-underline hover:bg-white/10">
            Download · blank exam (PDF)
          </a>
        </div>
        <ExecFooter />
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
          The session was frozen (you left full screen / switched tabs). Note the 4-hour timer keeps running. Ask an admin to
          press <strong className="text-white">Resume</strong>, then reload.
        </p>
        <button type="button" className="rounded-xl border border-white/15 bg-black/35 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10" onClick={() => window.location.reload()}>
          Reload after resume
        </button>
        <ExecFooter />
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
              {data.eligibilityReason ?? "You are not currently eligible for the Executive Officer exam."}
            </p>
            {data.requiredDays != null ? (
              <p className="mt-3 text-xs text-zinc-500">
                Tenure on {tier.fromRoleName}: <strong className="text-zinc-300">{Math.floor(data.tenureDays ?? 0)}</strong> /{" "}
                {data.requiredDays} days required.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mb-4 inline-flex rounded-full border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/90">
              {tier.label}
            </p>
            <h2 className="mb-4 text-xl font-black tracking-tight text-white sm:text-[1.35rem]">
              {tier.fromRoleName} → {tier.toRoleName}
            </h2>
            <p className="mb-6 text-[0.925rem] leading-relaxed text-zinc-400">
              One timed exam across <strong className="text-zinc-200">five sequential categories</strong> (unlocked one at a time):
              <br />
              <br />
              {data.categories?.map((c) => (
                <span key={c.id} className="block mb-1.5">
                  <strong className="text-zinc-200">{c.label}</strong>
                  {c.isFit
                    ? " — 5 professional fit scenarios (work context only)"
                    : ` — ${c.mcqCount} choice + ${c.writtenCount} written (starts at ${c.difficulty} tier)`}
                </span>
              ))}
              <br />
              After each expertise block, the <strong className="text-zinc-200">next category is generated at an adapted difficulty</strong> based on how you handled the prior one. Category 5 evaluates executive fit from your professional responses — never personal-life questions.
              <br />
              <br />
              <strong className="text-zinc-200">{tier.totalCount} questions total</strong> ·{" "}
              <strong className="text-zinc-200">{Math.round(tier.examMinutes / 60)} hours</strong> single timer. Auto-submits
              and grades when time ends.
              <br />
              <br />
              Written answers are typing-analyzed and combined with language quality for a{" "}
              <strong className="text-zinc-200">Cambridge / CEFR English estimate</strong>. Per-category expertise reports are
              owner-only after submit.
            </p>
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
        <ExecFooter />
      </Shell>
    );
  }

  // Active exam — current category only (sequential adaptive unlock).
  const timer = att.timerState?.exam;
  const remainingMs = timer ? new Date(timer.endsAt).getTime() - nowTick : 0;
  const lowTime = remainingMs <= 5 * 60_000;
  const tier = data.tier;
  const currentCategory = att.currentCategory ?? "leadership";
  const completedCount = att.categoryProgress?.completed.length ?? 0;
  const totalCategories = data.categories?.length ?? 5;
  const currentCatMeta = data.categories?.find((c) => c.id === currentCategory);
  const isFitCategory = currentCatMeta?.isFit ?? currentCategory === "fit";
  const fitDone = att.categoryProgress?.completed.some((c) => c.categoryId === "fit") ?? false;
  const allCategoriesDone = completedCount >= totalCategories || fitDone;

  const visibleQuestions = data.questions.filter((q) => (q.category ?? "leadership") === currentCategory);
  const answered = visibleQuestions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length;
  const categoryGroups = groupQuestionsByCategory(visibleQuestions);
  let questionNum = 0;

  return (
    <div className="relative min-h-[100dvh] px-4 py-7 sm:px-10 sm:py-12 pb-32">
      <div className="mx-auto w-full max-w-[820px]">
        <div className="sticky top-0 z-10 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-b from-black/80 to-black/40 px-4 py-3 backdrop-blur sm:-mx-10 sm:px-10">
          <div>
            <p className="text-sm font-black tracking-tight text-white">{EXEC_BRAND.handbookLine}</p>
            <p className="text-[11px] text-zinc-400">
              {tier.fromRoleName} → {tier.toRoleName} · Category {completedCount + 1}/{totalCategories}
              {currentCatMeta ? ` · ${currentCatMeta.label}` : ""} · {answered}/{visibleQuestions.length} answered
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
            <a href={`/api/executive-test/paper/${att.id}?variant=blank`} download className="text-[11px] font-semibold uppercase tracking-widest text-sky-300 no-underline hover:text-sky-200">
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

        {progressText ? (
          <p className="mb-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">{progressText}</p>
        ) : null}

        {err && <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</p>}

        <div className="flex flex-col gap-10">
          {categoryGroups.map((group) => (
            <section key={group.key}>
              <div className="mb-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-200">{group.label}</p>
              </div>
              <div className="flex flex-col gap-6">
                {group.items.map((q) => {
                  questionNum += 1;
                  const num = questionNum;
                  return (
            <div key={q.id} className="rounded-2xl border border-white/[0.08] bg-black/30 p-5 sm:p-6">
              <div className="mb-5 flex gap-4 text-[0.95rem] font-semibold leading-relaxed text-zinc-100">
                <span className="flex h-9 min-w-[2.75rem] shrink-0 items-center justify-center rounded-xl bg-white/[0.07] font-mono text-sm font-black text-indigo-300">
                  {num}
                </span>
                <span className="min-w-0 flex-1 pt-0.5">
                  {q.prompt}
                  <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    {q.type === "mcq" ? "choice" : "written"}
                  </span>
                </span>
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
                  onFocus={() => onFillFocus(q.id)}
                  onKeyDown={(e) => onFillKeyDown(q.id, e)}
                  onChange={(e) => onFillChange(q.id, e.target.value)}
                  disabled={submitting}
                  rows={5}
                  className="w-full resize-y rounded-xl border border-white/10 bg-black/45 px-4 py-3 text-[0.9rem] text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-indigo-400/40"
                  placeholder="Type your answer…"
                />
              )}
            </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          {!allCategoriesDone ? (
            <button
              type="button"
              disabled={advancing || submitting}
              onClick={() => void advanceCategory()}
              className="rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-8 py-3.5 font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-55"
            >
              {advancing
                ? "Generating next category…"
                : isFitCategory
                  ? "Complete fit assessment"
                  : `Finish ${currentCatMeta?.label ?? "section"} → unlock next`}
            </button>
          ) : null}
          {(allCategoriesDone || isFitCategory) && (
            <button
              type="button"
              disabled={submitting || advancing || (!allCategoriesDone && !isFitCategory)}
              onClick={async () => {
                if (isFitCategory && !fitDone) await advanceCategory();
                await submit(false);
              }}
              className="rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-8 py-3.5 font-bold text-white shadow-lg transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-55"
            >
              {submitting ? "Submitting…" : "Submit exam for AI draft + staff review"}
            </button>
          )}
        </div>
        <p className="mt-10 text-[10px] leading-relaxed text-zinc-600">
          When the timer ends the exam submits and grades automatically. Copyright © {new Date().getFullYear()} OpenSteam. All rights reserved.
        </p>
      </div>
    </div>
  );
}
