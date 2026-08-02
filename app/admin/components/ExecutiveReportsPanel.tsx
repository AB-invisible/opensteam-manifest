"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Download, Loader2, X } from "lucide-react";

type CategoryRow = {
  id: string;
  label: string;
  pct: number;
  handledLevel: string;
  isFit: boolean;
  fitRecommendation: string | null;
  pdfUrl: string;
};

type AttemptRow = {
  attemptId: string;
  status: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number;
  englishLevel: string | null;
  overallFit: { recommendation: string; rationale: string } | null;
  categories: CategoryRow[];
};

type ReportsData = {
  user: { id: string; username: string; discordId: string };
  attempts: AttemptRow[];
};

/** Owner-only panel: per-category Executive Officer expertise PDFs for one user. */
export default function ExecutiveReportsPanel({
  userId,
  username,
  onClose,
}: {
  userId: string;
  username: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/executive-reports?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        setErr("Owner access only.");
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.message ?? "Could not load reports");
        return;
      }
      setData(await res.json());
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-500/30 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-300" />
            <div>
              <p className="text-sm font-bold text-white">Executive Officer Reports</p>
              <p className="text-[11px] text-zinc-400">{username} · owner-only</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-4rem)] overflow-y-auto p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading category reports…
            </p>
          ) : err ? (
            <p className="text-sm text-red-300">{err}</p>
          ) : !data?.attempts.length ? (
            <p className="text-sm text-zinc-400">No submitted Executive Officer exams for this user yet.</p>
          ) : (
            <div className="space-y-6">
              {data.attempts.map((att) => (
                <div key={att.attemptId} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-white">
                        Attempt {att.attemptId.slice(0, 10)}… · {att.status}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {att.submittedAt ? new Date(att.submittedAt).toLocaleString() : "—"}
                        {att.score != null ? ` · ${att.score}/${att.maxScore} pts` : ""}
                        {att.englishLevel ? ` · English ${att.englishLevel}` : ""}
                      </p>
                    </div>
                    {att.overallFit ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                        Fit: {att.overallFit.recommendation.replace(/_/g, " ")}
                      </span>
                    ) : null}
                  </div>
                  {att.overallFit?.rationale ? (
                    <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">{att.overallFit.rationale}</p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {att.categories.map((c) => (
                      <a
                        key={c.id}
                        href={c.pdfUrl}
                        download
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-left no-underline transition-colors hover:border-amber-500/30 hover:bg-amber-500/5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-white">{c.label}</p>
                          <p className="text-[10px] text-zinc-500">
                            {c.isFit
                              ? c.fitRecommendation?.replace(/_/g, " ") ?? "fit"
                              : `${c.pct}% · ${c.handledLevel.replace(/_/g, " ")}`}
                          </p>
                        </div>
                        <Download className="h-4 w-4 shrink-0 text-amber-300" />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
