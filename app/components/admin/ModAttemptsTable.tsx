"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type AttemptRow = {
  id: string;
  status: string;
  /** Resolved UI status (TrialTest rows mix Prisma enum + sessionState). */
  uiStatus?: string;
  manualReview: string | null;
  pausedAt: string | null;
  lastPauseReason: string | null;
  submittedAt: string | null;
  aiGrade: unknown;
  score?: number | null;
  maxScore?: number | null;
  examLabel?: string;
  user: { username: string; discordId: string | null };
};

type AiDraftLine = {
  earned: number;
  max: number;
  rationale?: string;
  source: "mcq" | "ai";
};

type ReviewItemMcq = {
  index: number;
  kind: "mcq";
  id: string;
  prompt: string;
  choices: { A: string; B: string; C: string; D: string };
  answerLetter: string;
  staffKey?: { correct: string; points: number };
  aiDraft?: AiDraftLine | null;
};
type ReviewItemFill = {
  index: number;
  kind: "fill";
  id: string;
  prompt: string;
  answerText: string;
  staffKey?: { rubricForAi: string; maxPoints: number };
  aiDraft?: AiDraftLine | null;
};
type ReviewItem = ReviewItemMcq | ReviewItemFill;

type ReviewPayload = {
  attemptId: string;
  username: string | null;
  status: string;
  uiPhase?: string;
  sessionState?: string | null;
  submittedAt: string | null;
  answerCount: number;
  aiSummary?: {
    totalEarned: number;
    totalMax: number;
    aiModel?: string;
    gradedAt?: string;
  } | null;
  items: ReviewItem[];
};

export default function ModAttemptsTable() {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  const [reviewById, setReviewById] = useState<Record<string, ReviewPayload>>({});
  const [reviewLoading, setReviewLoading] = useState<string | null>(null);
  const [reviewErrById, setReviewErrById] = useState<Record<string, string>>({});

  useEffect(() => {
    expandedIdRef.current = expandedId;
  }, [expandedId]);

  const loadReview = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setReviewLoading(id);
    setReviewErrById((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
    try {
      const res = await fetch(`/api/admin/mod-attempts/${id}/review`);
      const j = (await res.json()) as ReviewPayload & { message?: string };
      if (!res.ok) throw new Error(j.message ?? res.statusText);
      setReviewById((prev) => ({ ...prev, [id]: j }));
    } catch (e: unknown) {
      setReviewErrById((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : "Failed to load",
      }));
    } finally {
      if (!opts?.silent) setReviewLoading(null);
    }
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch("/api/admin/mod-attempts");
        const j = await res.json();
        if (res.ok) {
          setRows(j.attempts ?? []);
          const eid = expandedIdRef.current;
          if (opts?.silent && eid) {
            setReviewById((p) => {
              if (!(eid in p)) return p;
              const n = { ...p };
              delete n[eid];
              return n;
            });
            void loadReview(eid, { silent: true });
          }
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [loadReview],
  );

  useEffect(() => {
    void load();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load({ silent: true });
    };
    const pollId = window.setInterval(tick, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const toggleReview = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!reviewById[id]) void loadReview(id);
  };

  const act = async (id: string, action: string) => {
    setWorking(`${id}:${action}`);
    const res = await fetch(`/api/admin/mod-attempts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = await res.json();
    setWorking(null);
    if (!res.ok) {
      alert(j.message ?? "Failed");
      return;
    }
    await load();
    setReviewById((prev) => {
      if (!(id in prev)) return prev;
      const n = { ...prev };
      delete n[id];
      return n;
    });
    if (expandedId === id) void loadReview(id);
  };

  const publish = async (id: string) => {
    setWorking(`${id}:publish_discord`);
    const res = await fetch(`/api/admin/mod-attempts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish_discord" }),
    });
    const j = await res.json().catch(() => ({}));
    setWorking(null);
    if (!res.ok) {
      alert(j.message ?? "Failed to publish");
      return;
    }
    alert("Result + PDF published to the Discord results channel.");
  };

  const scoreLine = (row: AttemptRow) => {
    const g = row.aiGrade;
    if (g && typeof g === "object") {
      const o = g as { totalEarned?: number; totalMax?: number };
      if (typeof o.totalEarned === "number" && typeof o.totalMax === "number") {
        return `${o.totalEarned}/${o.totalMax}`;
      }
    }
    if (typeof row.score === "number" && typeof row.maxScore === "number") {
      return `${row.score}/${row.maxScore}`;
    }
    return "—";
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Loader2 className="animate-spin" size={18} /> Loading attempts…
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
            <th style={{ padding: "0.75rem", color: "var(--muted-foreground)" }}>Candidate</th>
            <th style={{ padding: "0.75rem", color: "var(--muted-foreground)" }}>Status</th>
            <th style={{ padding: "0.75rem", color: "var(--muted-foreground)" }}>AI draft</th>
            <th style={{ padding: "0.75rem", color: "var(--muted-foreground)", minWidth: "200px" }}>Submission</th>
            <th style={{ padding: "0.75rem", color: "var(--muted-foreground)" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const uis = r.uiStatus ?? r.status;
            const rev = reviewById[r.id];
            return (
              <Fragment key={r.id}>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "top" }}>
                  <td style={{ padding: "0.75rem", fontSize: "0.85rem" }}>
                    <div style={{ fontWeight: 600 }}>{r.user?.username ?? "—"}</div>
                    {r.examLabel ? (
                      <div style={{ fontSize: "0.66rem", color: "#a5b4fc", fontWeight: 700 }}>{r.examLabel}</div>
                    ) : null}
                    <div style={{ fontSize: "0.7rem", color: "var(--muted-foreground)", wordBreak: "break-all" }}>
                      id {r.id.slice(0, 10)}…
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.8rem", maxWidth: "160px" }}>
                    <span style={{ whiteSpace: "nowrap" }}>{uis}</span>
                    {r.lastPauseReason && (
                      <div style={{ marginTop: "0.25rem", opacity: 0.8 }}>
                        Pause: <code style={{ fontSize: "0.65rem" }}>{r.lastPauseReason}</code>
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.85rem", fontFamily: "monospace" }}>{scoreLine(r)}</td>
                  <td style={{ padding: "0.75rem", fontSize: "0.68rem", lineHeight: 1.5 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-start" }}>
                      <button
                        type="button"
                        onClick={() => toggleReview(r.id)}
                        style={{
                          padding: "0.2rem 0",
                          margin: 0,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          color: "#c4fcf0",
                          fontWeight: 700,
                          fontSize: "0.75rem",
                          textDecoration: expandedId === r.id ? "underline" : undefined,
                          textAlign: "left",
                        }}
                      >
                        {expandedId === r.id ? "Hide preview" : "Preview exam (Qs + keys + answers)"}
                        {reviewLoading === r.id ? (
                          <Loader2 className="ml-1 inline animate-spin" size={12} />
                        ) : null}
                      </button>
                      <span style={{ color: "#94a3b8", fontSize: "0.65rem", lineHeight: 1.35 }}>
                        Staff-only: full question set and grading keys are available as soon as the attempt exists
                        — including before the candidate submits. PDFs use the same snapshot.
                      </span>
                      <a
                        href={`/api/admin/mod-attempts/${r.id}/paper?kind=keyed`}
                        download
                        title="MCQ keys, written rubrics, and any answers autosaved so far (confidential)"
                        style={{ color: "#a5b4fc", fontWeight: 700 }}
                      >
                        Download · staff packet (keys + responses so far) (PDF)
                      </a>
                      <a
                        href={`/api/admin/mod-attempts/${r.id}/paper?kind=blank`}
                        download
                        title="Question paper only — no keys in this file"
                        style={{ color: "#93c5fd", fontWeight: 600 }}
                      >
                        Download · blank paper (questions only · PDF)
                      </a>
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem", fontSize: "0.7rem" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      <Btn
                        label="Resume"
                        disabled={!!working || uis !== "paused"}
                        onClick={() => act(r.id, "resume")}
                        busy={working === `${r.id}:resume`}
                      />
                      <Btn
                        label="Approve"
                        tone="green"
                        disabled={!!working || uis !== "awaiting_manual_review"}
                        onClick={() => act(r.id, "approve")}
                        busy={working === `${r.id}:approve`}
                      />
                      <Btn
                        label="Reject"
                        tone="red"
                        disabled={!!working || uis !== "awaiting_manual_review"}
                        onClick={() => act(r.id, "reject")}
                        busy={working === `${r.id}:reject`}
                      />
                      <Btn
                        label="Re-grade (AI)"
                        disabled={!!working || uis !== "awaiting_manual_review"}
                        onClick={() => act(r.id, "regrade")}
                        busy={working === `${r.id}:regrade`}
                      />
                      <Btn
                        label="Publish to Discord"
                        disabled={
                          !!working ||
                          !["PASSED", "FAILED", "OVERRIDE_PASS", "OVERRIDE_FAIL"].includes(uis)
                        }
                        onClick={() => publish(r.id)}
                        busy={working === `${r.id}:publish_discord`}
                      />
                    </div>
                  </td>
                </tr>
                {expandedId === r.id ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: 0,
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(12,14,28,0.65)",
                      }}
                    >
                      <div style={{ padding: "1rem 1.25rem 1.5rem", fontSize: "0.8rem" }}>
                        {reviewErrById[r.id] ? (
                          <p style={{ color: "#fca5a5" }}>{reviewErrById[r.id]}</p>
                        ) : reviewLoading === r.id ? (
                          <span style={{ color: "var(--muted-foreground)" }}>Loading…</span>
                        ) : rev ? (
                          <>
                            <p style={{ marginBottom: "0.75rem", color: "#a1a1aa", fontSize: "0.75rem" }}>
                              Snapshot for attempt <code style={{ fontSize: "0.7rem" }}>{rev.attemptId.slice(0, 12)}…</code>
                              {rev.submittedAt ? ` · submitted ${rev.submittedAt}` : ""} ·{" "}
                              {rev.answerCount} answer field{rev.answerCount === 1 ? "" : "s"} saved (autosave may be in progress)
                              {rev.uiPhase ? (
                                <>
                                  {" "}
                                  · phase: <strong style={{ color: "#e4e4e7" }}>{rev.uiPhase}</strong>
                                </>
                              ) : null}
                            </p>
                            {rev.aiSummary ? (
                              <p
                                style={{
                                  marginBottom: "0.85rem",
                                  padding: "0.5rem 0.65rem",
                                  borderRadius: "0.45rem",
                                  background: "rgba(8,70,56,0.3)",
                                  border: "1px solid rgba(45,212,191,0.28)",
                                  color: "#99f6e4",
                                  fontSize: "0.75rem",
                                  lineHeight: 1.45,
                                }}
                              >
                                <strong style={{ color: "#5eead4" }}>AI draft exam total:</strong>{" "}
                                {rev.aiSummary.totalEarned}/{rev.aiSummary.totalMax} pts
                                {rev.aiSummary.aiModel ? (
                                  <>
                                    {" "}
                                    · <span style={{ opacity: 0.92 }}>{rev.aiSummary.aiModel}</span>
                                  </>
                                ) : null}
                                {rev.aiSummary.gradedAt ? (
                                  <>
                                    {" "}
                                    · <span style={{ opacity: 0.85 }}>{rev.aiSummary.gradedAt}</span>
                                  </>
                                ) : null}
                                <span style={{ display: "block", marginTop: "0.35rem", opacity: 0.88, fontSize: "0.68rem" }}>
                                  Per-question AI points for written responses appear under each item. Not final until staff
                                  approves.
                                </span>
                              </p>
                            ) : null}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "1rem",
                                maxHeight: "min(68vh, 520px)",
                                overflowY: "auto",
                              }}
                            >
                              {rev.items.map((it) => (
                                <div
                                  key={it.id}
                                  style={{
                                    borderRadius: "0.6rem",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    padding: "0.75rem 1rem",
                                    background: "rgba(0,0,0,0.35)",
                                  }}
                                >
                                  <div style={{ fontWeight: 700, color: "#e4e4e7", marginBottom: "0.35rem" }}>
                                    Q{it.index}
                                    {it.kind === "mcq" ? " · Multiple choice" : " · Written"}
                                  </div>
                                  <p style={{ color: "#d4d4d8", marginBottom: "0.5rem", whiteSpace: "pre-wrap" }}>{it.prompt}</p>
                                  {it.kind === "mcq" ? (
                                    <>
                                      <div style={{ fontSize: "0.72rem", color: "#a1a1aa", marginBottom: "0.35rem" }}>
                                        {(["A", "B", "C", "D"] as const).map((L) => (
                                          <div key={L} style={{ marginTop: "0.15rem" }}>
                                            <strong style={{ color: "#e7e5e4" }}>{L}.</strong> {it.choices[L]}
                                          </div>
                                        ))}
                                      </div>
                                      <div style={{ fontWeight: 700, color: "#86efac" }}>
                                        Candidate selection:{" "}
                                        {it.answerLetter?.trim() ? it.answerLetter.toUpperCase() : "(none yet)"}
                                      </div>
                                      {it.staffKey ? (
                                        <div
                                          style={{
                                            marginTop: "0.5rem",
                                            padding: "0.5rem 0.65rem",
                                            borderRadius: "0.45rem",
                                            background: "rgba(127,29,29,0.25)",
                                            border: "1px solid rgba(248,113,113,0.35)",
                                            fontSize: "0.72rem",
                                            color: "#fecaca",
                                          }}
                                        >
                                          <strong style={{ letterSpacing: "0.04em" }}>STAFF · ANSWER KEY:</strong>{" "}
                                          {it.staffKey.correct} ({it.staffKey.points} pts)
                                        </div>
                                      ) : null}
                                      {it.aiDraft ? <StaffAiDraftPanel draft={it.aiDraft} /> : null}
                                    </>
                                  ) : (
                                    <>
                                    <div style={{ whiteSpace: "pre-wrap", color: "#fde68a" }}>
                                      {it.answerText?.trim() ? it.answerText : "(empty — not submitted / draft)"}
                                    </div>
                                    {it.aiDraft ? <StaffAiDraftPanel draft={it.aiDraft} /> : null}
                                    {it.staffKey ? (
                                      <div
                                        style={{
                                          marginTop: "0.5rem",
                                          padding: "0.5rem 0.65rem",
                                          borderRadius: "0.45rem",
                                          background: "rgba(127,29,29,0.22)",
                                          border: "1px solid rgba(248,113,113,0.3)",
                                          fontSize: "0.72rem",
                                          color: "#fecdd3",
                                        }}
                                      >
                                        <div style={{ fontWeight: 800, marginBottom: "0.35rem", color: "#fca5a5" }}>
                                          STAFF · GRADING RUBRIC (max {it.staffKey.maxPoints} pts)
                                        </div>
                                        <div style={{ whiteSpace: "pre-wrap", color: "#fecdd3" }}>
                                          {it.staffKey.rubricForAi}
                                        </div>
                                      </div>
                                    ) : null}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: "2rem", color: "var(--muted-foreground)" }}>
                No staff exam attempts recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StaffAiDraftPanel({ draft }: { draft: AiDraftLine }) {
  const title =
    draft.source === "ai"
      ? `AI draft · ${draft.earned}/${draft.max} pts written (not final until staff confirms)`
      : `Auto score · ${draft.earned}/${draft.max} pts (MCQ)`;
  return (
    <div
      style={{
        marginTop: "0.5rem",
        padding: "0.5rem 0.65rem",
        borderRadius: "0.45rem",
        background: "rgba(6,78,59,0.35)",
        border: "1px solid rgba(45,212,191,0.45)",
        fontSize: "0.72rem",
        color: "#ccfbf1",
      }}
    >
      <div style={{ fontWeight: 800, color: "#5eead4", marginBottom: draft.rationale?.trim() ? "0.35rem" : 0 }}>
        {title}
      </div>
      {draft.rationale?.trim() ? (
        <div style={{ whiteSpace: "pre-wrap", color: "#99f6e4", lineHeight: 1.45 }}>{draft.rationale}</div>
      ) : null}
    </div>
  );
}

function Btn({
  label,
  onClick,
  disabled,
  busy,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "green" | "red";
}) {
  const bg =
    tone === "green"
      ? "rgba(16,185,129,0.2)"
      : tone === "red"
        ? "rgba(239,68,68,0.2)"
        : "rgba(59,130,246,0.18)";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "0.25rem 0.45rem",
        borderRadius: "0.35rem",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        background: bg,
        color: tone === "red" ? "#fca5a5" : tone === "green" ? "#86efac" : "#bfdbfe",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.2rem",
        fontWeight: 600,
      }}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : null}
      {label}
    </button>
  );
}
