/**
 * Posts trial-moderator assessment outcomes (pass/fail) to the Discord results channel.
 * Mirrors the application-results embed, and additionally attaches the candidate's
 * exam record PDF (footer carries "Graded by" / "Approved" accountability lines).
 */
import { prisma } from "@/app/lib/prisma";
import { pdfFromTrialSnapshot, type ExamPdfBrand } from "@/app/lib/mod-assessment-pdf";
import { parseQuestions } from "@/app/lib/mod-assessment-types";

/** Override via SystemConfig key `DISCORD_TRIAL_RESULTS_CHANNEL_ID`; otherwise this default. */
const DEFAULT_TRIAL_RESULTS_CHANNEL_ID = "1521048622278512670";

/** Always the grader of record — the assessment is system/AI graded, then staff-confirmed. */
export const GRADED_BY_LABEL = "OpenSteam System";

export type TrialTestForResult = {
  id: string;
  userId: string;
  status: string;
  score: number | null;
  maxScore: number;
  passingScore: number;
  submittedAt: Date | null;
  questions: unknown;
  answers: unknown;
  examAnswerKey: unknown;
  aiGrade: unknown;
  user?: { username: string | null; discordId: string | null } | null;
};

export type TrialResultGrader = {
  id: string;
  username?: string | null;
  discordId?: string | null;
};

/** Footer / embed "Approved" label: "<name> (<discord-or-db id>)", or the system fallback. */
export function approvedByLabel(grader: TrialResultGrader | null | undefined): string {
  if (!grader) return GRADED_BY_LABEL;
  const name = grader.username?.trim() || "Staff";
  const id = grader.discordId?.trim() || grader.id;
  return `${name} (${id})`;
}

function safeFileSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "candidate";
}

/**
 * Best-effort: builds an embed (+ candidate-record PDF when the snapshot is a live exam)
 * and posts it to the trial results channel. Never throws — failures are logged and swallowed
 * so callers can fire-and-forget without affecting the grading request.
 */
export async function postTrialResultToDiscord(opts: {
  test: TrialTestForResult;
  grader?: TrialResultGrader | null;
  outcome: "PASSED" | "FAILED";
  /** Embed/result label, e.g. "Senior Moderator Promotion". Defaults to the trial mod label. */
  resultLabel?: string;
  /** PDF header/footer branding override (e.g. promotional exams). */
  brand?: ExamPdfBrand;
  /** Embed footer line override. */
  footerText?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { test, grader, outcome } = opts;
  const resultLabel = opts.resultLabel ?? "Trial Moderator";
  const footerText = opts.footerText ?? "OpenSteam Trial Moderator System";
  try {
    const tokenCfg = await prisma.systemConfig.findUnique({ where: { key: "DISCORD_BOT_TOKEN" } });
    if (!tokenCfg?.value) return { ok: false, error: "DISCORD_BOT_TOKEN not configured" };

    const channelCfg = await prisma.systemConfig.findUnique({
      where: { key: "DISCORD_TRIAL_RESULTS_CHANNEL_ID" },
    });
    const channelId = channelCfg?.value?.trim() || DEFAULT_TRIAL_RESULTS_CHANNEL_ID;

    const approvedBy = approvedByLabel(grader);
    const isPassed = outcome === "PASSED";

    let pdfBytes: Uint8Array | null = null;
    try {
      const qs = parseQuestions(test.questions);
      if (qs.length > 0) {
        pdfBytes = await pdfFromTrialSnapshot({
          questionsJson: test.questions,
          answersJson: test.answers,
          examAnswerKeyJson: test.examAnswerKey,
          mode: "candidate_record",
          aiGradeJson: test.aiGrade,
          brand: opts.brand,
          meta: {
            candidateDisplayName: test.user?.username ?? undefined,
            trialStatus: test.status,
            score: test.score,
            maxScore: test.maxScore,
            passingScore: test.passingScore,
            submittedAtIso: test.submittedAt ? test.submittedAt.toISOString() : null,
            gradedByLabel: GRADED_BY_LABEL,
            approvedByLabel: approvedBy,
          },
        });
      }
    } catch (pdfErr) {
      console.error("[Trial Result PDF Error]", pdfErr);
    }

    const candidate = test.user?.username || test.userId;
    const embed = {
      title: `🛡️ ${resultLabel} Result: ${isPassed ? "Passed" : "Failed"}`,
      description: `Results for **${candidate}**`,
      color: isPassed ? 0x10b981 : 0xef4444,
      fields: [
        {
          name: "User",
          value: test.user?.discordId ? `<@${test.user.discordId}>` : String(candidate),
          inline: true,
        },
        {
          name: "Score",
          value: `**${test.score ?? "—"}/${test.maxScore}**`,
          inline: true,
        },
        { name: "Status", value: isPassed ? "✅ Passed" : "❌ Failed", inline: true },
        { name: "Graded by", value: GRADED_BY_LABEL, inline: true },
        { name: "Approved", value: approvedBy, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: footerText },
    };

    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

    if (pdfBytes) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ embeds: [embed] }));
      const fileName = `trial-result-${safeFileSegment(String(candidate))}-${test.id.slice(0, 8)}.pdf`;
      form.append(
        "files[0]",
        new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" }),
        fileName,
      );
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bot ${tokenCfg.value}` },
        body: form,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { ok: false, error: `Discord ${res.status}: ${detail.slice(0, 300)}` };
      }
      return { ok: true };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bot ${tokenCfg.value}`, "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Discord ${res.status}: ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    console.error("[Trial Result Discord Error]", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
