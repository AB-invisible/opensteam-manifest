/**
 * Owner-only per-category expertise PDFs for the Executive Officer exam.
 * Each PDF covers one category's questions, scores, handled-level, and AI summary.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq, parseQuestions } from "@/app/lib/mod-assessment-types";
import { normalizeTrialAnswersJson } from "@/app/lib/mod-assessment-normalize-answers";
import { perQuestionScoresFromStoredAiGrade } from "@/app/lib/mod-assessment-grade";
import { EXEC_BRAND } from "@/app/lib/exec-brand";
import {
  EXEC_CATEGORY_MAP,
  type ExecCategoryId,
} from "@/app/lib/exec-categories";
import type { CategoryGradeReport } from "@/app/lib/exec-category-grade";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 52;
const LINE = 13;
const BODY = 9;

function ascii(s: string): string {
  return s.replace(/[^\x20-\x7E\n\r]/g, "?");
}

function wrap(maxChars: number, text: string): string[] {
  const plain = ascii(text.trim() || "");
  const words = plain.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (tryLine.length <= maxChars) cur = tryLine;
    else {
      if (cur) lines.push(cur);
      cur = w.length <= maxChars ? w : w.slice(0, maxChars);
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

type Layout = { page: PDFPage; y: number; font: PDFFont; bold: PDFFont };

function newPage(doc: PDFDocument, fonts: { font: PDFFont; bold: PDFFont }): Layout {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return { page, y: PAGE_H - M, ...fonts };
}

function ensureSpace(layout: Layout, doc: PDFDocument, fonts: { font: PDFFont; bold: PDFFont }, need: number): Layout {
  if (layout.y - need < M + 40) return newPage(doc, fonts);
  return layout;
}

function drawLines(layout: Layout, doc: PDFDocument, fonts: { font: PDFFont; bold: PDFFont }, lines: string[], size = BODY, bold = false): Layout {
  const f = bold ? layout.bold : layout.font;
  for (const line of lines) {
    layout = ensureSpace(layout, doc, fonts, LINE);
    layout.page.drawText(line, { x: M, y: layout.y, size, font: f, color: rgb(0.12, 0.12, 0.14) });
    layout.y -= LINE;
  }
  return layout;
}

export async function pdfExecCategoryReport(args: {
  categoryId: ExecCategoryId;
  report: CategoryGradeReport;
  questionsJson: unknown;
  answersJson: unknown;
  aiGradeJson: unknown;
  candidateName?: string;
  attemptId: string;
  submittedAtIso?: string | null;
  englishLevel?: string | null;
}): Promise<Uint8Array> {
  const catDef = EXEC_CATEGORY_MAP[args.categoryId];
  const allQs = parseQuestions(args.questionsJson);
  const qs = allQs.filter((q) => q.category === args.categoryId);
  const answers = normalizeTrialAnswersJson(args.answersJson);
  const scores = perQuestionScoresFromStoredAiGrade(args.aiGradeJson);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { font, bold };

  let layout = newPage(doc, fonts);

  layout = drawLines(layout, doc, fonts, [EXEC_BRAND.primaryLine], 11, true);
  layout = drawLines(layout, doc, fonts, [EXEC_BRAND.handbookLine], 10, true);
  layout.y -= 4;
  layout = drawLines(
    layout,
    doc,
    fonts,
    [
      "OWNER-ONLY — Executive Officer Category Report",
      `Category: ${args.report.label}`,
      `Candidate: ${args.candidateName ?? "—"}`,
      `Attempt: ${args.attemptId.slice(0, 12)}`,
      args.submittedAtIso ? `Submitted: ${args.submittedAtIso}` : "",
    ].filter(Boolean),
    9,
  );
  layout.y -= 8;

  if (args.report.isFit) {
    layout = drawLines(layout, doc, fonts, ["— Executive Fit Assessment —"], 10, true);
    layout = drawLines(layout, doc, fonts, [
      `Recommendation: ${(args.report.fitRecommendation ?? "—").replace(/_/g, " ").toUpperCase()}`,
      args.report.fitRationale ?? "",
      args.report.expertiseSummary,
    ]);
  } else {
    layout = drawLines(layout, doc, fonts, ["— Expertise Summary —"], 10, true);
    layout = drawLines(layout, doc, fonts, [
      `Difficulty tier: ${args.report.difficulty.toUpperCase()}`,
      `Score: ${args.report.earned}/${args.report.max} (${args.report.pct}%)`,
      `Handled as: ${args.report.handledLabel}`,
      `MCQ: ${args.report.mcqEarned}/${args.report.mcqMax} · Written: ${args.report.writtenEarned}/${args.report.writtenMax}`,
      args.englishLevel ? `Estimated English (exam-wide): ${args.englishLevel}` : "",
      "",
      args.report.expertiseSummary,
    ].filter(Boolean));
    if (args.report.strengths.length) {
      layout.y -= 4;
      layout = drawLines(layout, doc, fonts, ["Strengths:"], 9, true);
      layout = drawLines(layout, doc, fonts, args.report.strengths.map((s) => `• ${s}`));
    }
    if (args.report.gaps.length) {
      layout.y -= 4;
      layout = drawLines(layout, doc, fonts, ["Development areas:"], 9, true);
      layout = drawLines(layout, doc, fonts, args.report.gaps.map((s) => `• ${s}`));
    }
  }

  layout.y -= 10;
  layout = drawLines(layout, doc, fonts, ["— Questions & Responses —"], 10, true);

  qs.forEach((q, idx) => {
    layout.y -= 6;
    const sc = scores[q.id];
    const scoreLine = sc ? ` [${sc.earned}/${sc.max} pts]` : "";
    layout = drawLines(layout, doc, fonts, [`Q${idx + 1}.${scoreLine} ${q.prompt}`], BODY, true);
    if (isMcq(q)) {
      const letter = (answers[q.id] ?? "—").toUpperCase();
      layout = drawLines(layout, doc, fonts, [`Answer: ${letter}`]);
    } else {
      const ans = answers[q.id] ?? "(no answer)";
      layout = drawLines(layout, doc, fonts, wrap(88, ans));
    }
  });

  layout.y = M + 20;
  layout.page.drawText(
    ascii("Confidential — OpenSteam Owner Reports — not for candidate distribution"),
    { x: M, y: M, size: 7, font, color: rgb(0.45, 0.45, 0.5) },
  );

  return doc.save();
}
