/**
 * Generates printable PDFs for the live moderator exam — OpenSteam branded header, optional outcome summary, footer.
 */
import { readFile } from "fs/promises";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq, parseQuestions } from "@/app/lib/mod-assessment-types";
import { resolveExamAnswerKey, type ExamAnswerKeyV1 } from "@/app/lib/mod-assessment-answer-key";
import { MOD_ASSESSMENT_BRAND } from "@/app/lib/mod-assessment-brand";
import { normalizeTrialAnswersJson } from "@/app/lib/mod-assessment-normalize-answers";
import { perQuestionScoresFromStoredAiGrade } from "@/app/lib/mod-assessment-grade";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 52;
const LINE = 13;
const BODY = 9;

/** Same branding copy as web + `mod-assessment-brand.ts`. */
export const PDF_BRAND = MOD_ASSESSMENT_BRAND;

export type ModExamPdfMeta = {
  candidateDisplayName?: string;
  /** Prisma TrialTest.status string */
  trialStatus: string;
  score: number | null;
  maxScore: number;
  passingScore: number;
  submittedAtIso?: string | null;
  /** Omit summary strip (blank paper headers only). */
  includeOutcomeBanner?: boolean;
  /** Footer accountability line — who/what produced the grade (e.g. "OpenSteam System"). */
  gradedByLabel?: string;
  /** Footer accountability line — the staff member who approved/failed the candidate, incl. their user id. */
  approvedByLabel?: string;
};

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
      if (w.length <= maxChars) cur = w;
      else {
        let rest = w;
        while (rest.length > maxChars) {
          lines.push(rest.slice(0, maxChars));
          rest = rest.slice(maxChars);
        }
        cur = rest;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

async function loadZkLogoBytes(): Promise<Uint8Array | null> {
  try {
    const p = join(process.cwd(), "public", "opensteam.png");
    return new Uint8Array(await readFile(p));
  } catch {
    try {
      const p = join(process.cwd(), "public", "zk-exam-logo.png");
      return new Uint8Array(await readFile(p));
    } catch {
      return null;
    }
  }
}

async function embedLogo(doc: PDFDocument, png: Uint8Array) {
  try {
    return await doc.embedPng(png);
  } catch {
    try {
      return await doc.embedJpg(png);
    } catch {
      return null;
    }
  }
}

function pctOf(score: number, max: number): string {
  if (max <= 0) return "0";
  return (Math.round((score / max) * 1000) / 10).toFixed(1);
}

function resultHeadline(meta: ModExamPdfMeta): string[] {
  const s = meta.trialStatus;
  const lines: string[] = [];

  switch (s) {
    case "PASSED":
      lines.push("Result: PASSED");
      break;
    case "OVERRIDE_PASS":
      lines.push("Result: PASSED (staff override)");
      break;
    case "FAILED":
      lines.push("Result: NOT PASSED");
      break;
    case "OVERRIDE_FAIL":
      lines.push("Result: NOT PASSED (staff override)");
      break;
    case "AWAITING_STAFF":
      lines.push("Result: Pending — AI draft awaits staff confirmation (not final until approved)");
      break;
    case "ACTIVE":
      lines.push("Result: Assessment in progress (saved answers may be incomplete)");
      break;
    default:
      lines.push(`Result status: ${s}`);
  }

  const mx = meta.maxScore;
  if (meta.score != null) {
    const sc = meta.score;
    lines.push(`Score: ${sc} / ${mx} (${pctOf(sc, mx)}%)`);
  } else if (s === "AWAITING_STAFF" || s === "SUBMITTED") {
    lines.push(`Score: pending final grade (maximum ${mx} pts)`);
  } else if (s === "ACTIVE") {
    lines.push(`Score: not yet submitted (maximum ${mx} pts)`);
  } else {
    lines.push(`Score: — / ${mx}`);
  }
  lines.push(`Passing threshold on this exam: ${meta.passingScore} pts (${pctOf(meta.passingScore, mx)}% of points)`);

  return lines;
}

function questionMaxPoints(q: ModQuestion, ki: ExamAnswerKeyV1["items"][number] | undefined): number {
  if (ki?.kind === "mcq") return ki.points;
  if (ki?.kind === "fill") return ki.maxPoints;
  return isMcq(q) ? (q.points ?? 10) : q.maxPoints;
}

/** earned null => written item not graded yet (no AI row); MCQs still get 0/max from key when possible */
function resolveQuestionPoints(args: {
  q: ModQuestion;
  ki: ExamAnswerKeyV1["items"][number] | undefined;
  aiRow: { earned: number; max: number } | undefined;
  mode: "blank" | "candidate_record" | "staff_packet";
  answerRaw: string;
}): { max: number; earned: number | null; label: "blank" | "scored" | "pending" } {
  const max = questionMaxPoints(args.q, args.ki);
  if (args.mode === "blank") {
    return { max, earned: null, label: "blank" };
  }
  if (args.aiRow && typeof args.aiRow.earned === "number" && typeof args.aiRow.max === "number") {
    return { max: args.aiRow.max, earned: args.aiRow.earned, label: "scored" };
  }
  if (isMcq(args.q) && args.ki?.kind === "mcq") {
    const ok =
      args.answerRaw.trim().length === 1 &&
      args.answerRaw.trim().toUpperCase() === args.ki.correct.toUpperCase();
    return { max: args.ki.points, earned: ok ? args.ki.points : 0, label: "scored" };
  }
  return { max, earned: null, label: "pending" };
}

export type ExamPdfBrand = {
  primaryLine: string;
  handbookLine: string;
  assessmentLine: string;
};

export async function renderLiveExamPdf(args: {
  subtitleLines?: string[];
  questions: ModQuestion[];
  mode: "blank" | "candidate_record" | "staff_packet";
  answers?: Record<string, string>;
  answerKey?: ExamAnswerKeyV1 | null;
  meta?: ModExamPdfMeta | null;
  /** `TrialTest.aiGrade` — used for per-question earned/max on candidate + staff PDFs */
  aiGradeJson?: unknown | null;
  /** Header / footer branding override (e.g. promotional exams). Defaults to the trial brand. */
  brand?: ExamPdfBrand;
}): Promise<Uint8Array> {
  const brand: ExamPdfBrand = args.brand ?? PDF_BRAND;
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const draw = (
    txt: string,
    opts?: { size?: number; font?: PDFFont; dy?: number; color?: ReturnType<typeof rgb> },
  ) => {
    const size = opts?.size ?? BODY;
    const font = opts?.font ?? reg;
    const dy = opts?.dy ?? LINE;
    const color = opts?.color ?? rgb(0.06, 0.06, 0.09);
    if (y < M + 48) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
    }
    page.drawText(txt, {
      x: M,
      y,
      size,
      font,
      color,
      maxWidth: PAGE_W - 2 * M,
    });
    y -= dy;
  };

  /** Branded header: left titles, right logo, full-width ruler */
  const logoBytes = await loadZkLogoBytes();
  let logoEmbedded = logoBytes ? await embedLogo(doc, logoBytes) : null;

  const headerBandTop = PAGE_H - M;
  let textBaseline = headerBandTop - 16;

  page.drawText(ascii(brand.primaryLine), {
    x: M,
    y: textBaseline,
    size: 15,
    font: bold,
    color: rgb(0.04, 0.04, 0.06),
  });
  textBaseline -= 17;
  page.drawText(ascii(brand.handbookLine), {
    x: M,
    y: textBaseline,
    size: 12,
    font: bold,
    color: rgb(0.04, 0.04, 0.06),
  });
  textBaseline -= 13;
  page.drawText(ascii(brand.assessmentLine), {
    x: M,
    y: textBaseline,
    size: 9,
    font: reg,
    color: rgb(0.38, 0.38, 0.43),
  });

  const logoW = 58;
  if (logoEmbedded) {
    const lh = (logoEmbedded.height / logoEmbedded.width) * logoW;
    const lx = PAGE_W - M - logoW;
    const ly = PAGE_H - M - lh;
    page.drawImage(logoEmbedded, { x: lx, y: ly, width: logoW, height: lh });
  }

  /** Single rule under handbook header + logo band */
  const sepY = PAGE_H - M - 86;
  page.drawLine({
    start: { x: M, y: sepY },
    end: { x: PAGE_W - M, y: sepY },
    thickness: 0.9,
    color: rgb(0.16, 0.16, 0.2),
  });

  y = sepY - 14;

  for (const s of args.subtitleLines ?? []) {
    for (const ln of wrap(96, s)) draw(ln, { size: BODY });
  }

  const meta = args.meta ?? null;
  const showOutcome =
    args.mode !== "blank" &&
    Boolean(meta?.trialStatus?.trim()) &&
    meta?.includeOutcomeBanner !== false;

  if (showOutcome && meta) {
    draw("Summary", { font: bold, size: BODY + 2, dy: LINE + 2 });
    if (meta.candidateDisplayName?.trim())
      draw(`Candidate: ${ascii(meta.candidateDisplayName)}`, { size: BODY });
    if (meta.submittedAtIso)
      draw(`Submitted: ${ascii(meta.submittedAtIso)}`, { size: BODY - 1, color: rgb(0.28, 0.28, 0.34) });
    draw(`System status: ${ascii(meta.trialStatus)}`, { size: BODY - 0.5, color: rgb(0.3, 0.3, 0.38) });

    const rh = resultHeadline(meta);
    for (const line of rh) draw(line, { font: bold, size: BODY, color: rgb(0.02, 0.1, 0.28) });

    draw(`Exam items on this PDF: ${args.questions.length}`, { size: BODY - 1, color: rgb(0.34, 0.34, 0.4) });

    if (y < M + 44) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
    }
    page.drawLine({
      start: { x: M, y },
      end: { x: PAGE_W - M, y },
      thickness: 0.45,
      color: rgb(0.82, 0.82, 0.87),
    });
    y -= 18;
  }

  const keyById = new Map(
    (args.answerKey?.items ?? []).map((i) => [i.id, i] as const),
  );

  const aiByQid = perQuestionScoresFromStoredAiGrade(args.aiGradeJson ?? undefined);

  let qi = 0;
  for (const q of args.questions) {
    qi += 1;
    const ki = keyById.get(q.id);
    const rawAns = (args.answers?.[q.id] ?? "").trim();
    const pts = resolveQuestionPoints({
      q,
      ki,
      aiRow: aiByQid[q.id],
      mode: args.mode,
      answerRaw: rawAns,
    });

    const pointsCaption =
      pts.label === "blank"
        ? `Max points: ${pts.max}`
        : pts.earned !== null
          ? `Points: ${pts.earned} / ${pts.max}`
          : `Points: — / ${pts.max} (not graded)`;

    draw(`Question ${qi}  (${isMcq(q) ? "Multiple choice" : "Written"})  ·  ${pointsCaption}`, {
      size: BODY + 1,
      font: bold,
      dy: LINE + 1,
    });
    for (const ln of wrap(94, q.prompt)) draw(ln);

    if (isMcq(q)) {
      for (const L of ["A", "B", "C", "D"] as const) {
        for (const ln of wrap(90, `${L}. ${q.choices[L]}`)) draw(ln, { dy: LINE - 0.5 });
      }
    }

    if (args.mode === "blank") {
      draw(isMcq(q) ? "--- Select A-D in web app ---" : "--- Written answer in web app ---", {
        size: BODY - 0.5,
      });
      y -= 4;
      if (y < M + 44) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - M;
      }
      page.drawLine({
        start: { x: M, y },
        end: { x: PAGE_W - M, y },
        thickness: 0.3,
        color: rgb(0.9, 0.9, 0.93),
      });
      y -= 12;
      continue;
    }

    const raw = (args.answers?.[q.id] ?? "").trim();
    draw(isMcq(q) ? `Candidate answer: ${raw ? raw.toUpperCase() : "(none)"}` : "Candidate answer:", {
      font: bold,
      size: BODY,
    });
    if (!isMcq(q)) {
      for (const ln of wrap(94, raw || "(empty)")) draw(ln);
    }

    if (args.mode === "staff_packet") {
      const ki = keyById.get(q.id);
      if (ki?.kind === "mcq") {
        draw(`ANSWER KEY: ${ki.correct} (${ki.points} pts)`, { font: bold, size: BODY });
      } else if (ki?.kind === "fill") {
        draw(`ANSWER KEY — rubric (max ${ki.maxPoints} pts):`, { font: bold, size: BODY });
        for (const ln of wrap(92, ki.rubricForAi)) draw(ln);
      }
    }

    y -= 6;
    if (y < M + 44) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
    }
    page.drawLine({
      start: { x: M, y },
      end: { x: PAGE_W - M, y },
      thickness: 0.35,
      color: rgb(0.88, 0.88, 0.92),
    });
    y -= 12;
  }

  const yr = new Date().getFullYear();
  draw(
    ascii(
      args.mode === "staff_packet"
        ? `Staff confidential copy (includes grading keys).  © ${yr} OpenSteam. All rights reserved.`
        : args.mode === "candidate_record"
          ? `Personal candidate record · © ${yr} OpenSteam. All rights reserved.`
          : `Blank examination paper · © ${yr} OpenSteam. All rights reserved.`,
    ),
    { size: BODY - 1 },
  );

  const pages = doc.getPages();
  const last = pages[pages.length - 1];
  if (last) {
    const gradedBy = args.meta?.gradedByLabel?.trim();
    const approvedBy = args.meta?.approvedByLabel?.trim();
    if (gradedBy) {
      last.drawText(ascii(`Graded by: ${gradedBy}`), {
        x: M,
        y: M + 52,
        size: 8,
        font: bold,
        color: rgb(0.18, 0.18, 0.26),
        maxWidth: PAGE_W - 2 * M,
      });
    }
    if (approvedBy) {
      last.drawText(ascii(`Approved: ${approvedBy}`), {
        x: M,
        y: M + 40,
        size: 8,
        font: bold,
        color: rgb(0.18, 0.18, 0.26),
        maxWidth: PAGE_W - 2 * M,
      });
    }
    last.drawText(ascii(`${brand.primaryLine}. Unauthorized reproduction prohibited.`), {
      x: M,
      y: M + 28,
      size: 7.5,
      font: reg,
      color: rgb(0.45, 0.45, 0.52),
      maxWidth: PAGE_W - 2 * M,
    });
    last.drawText(ascii(`Copyright © ${yr} OpenSteam. All rights reserved.`), {
      x: M,
      y: M + 16,
      size: 7.5,
      font: reg,
      color: rgb(0.45, 0.45, 0.52),
    });
  }

  return doc.save();
}

export const LIVE_ASSESSMENT_PDF_TITLE = "Moderator assessment (live)";

function normalizeAnswersJson(j: unknown): Record<string, string> {
  return normalizeTrialAnswersJson(j);
}

export async function pdfFromTrialSnapshot(args: {
  questionsJson: unknown;
  answersJson: unknown | null;
  examAnswerKeyJson: unknown | null;
  mode: "blank" | "candidate_record" | "staff_packet";
  meta?: Partial<ModExamPdfMeta> | null;
  /** When set, PDF shows per-question earned/max (candidate + staff modes). */
  aiGradeJson?: unknown | null;
  /** Header / footer branding override (e.g. promotional exams). */
  brand?: ExamPdfBrand;
}): Promise<Uint8Array> {
  const questions = parseQuestions(args.questionsJson);
  const answerKey = resolveExamAnswerKey(args.examAnswerKeyJson, questions);
  const answers = args.mode === "blank" ? undefined : normalizeAnswersJson(args.answersJson);

  const base = args.meta ?? {};
  const subtitleLines: string[] = [];
  if (args.mode === "blank") {
    subtitleLines.push("Blank examination paper — questions only (responses are captured in-platform).");
  } else if (args.mode === "candidate_record") {
    subtitleLines.push("Examination record — your submitted answers on the following pages.");
  } else {
    subtitleLines.push(
      "Staff packet — this candidate's responses appear under each question; MCQ/exact keys and rubrics follow.",
    );
  }

  const metaPack: ModExamPdfMeta | undefined =
    args.mode === "blank"
      ? undefined
      : {
          candidateDisplayName: base.candidateDisplayName,
          trialStatus: base.trialStatus ?? "UNKNOWN",
          score: base.score ?? null,
          maxScore: base.maxScore ?? 100,
          passingScore: base.passingScore ?? 70,
          submittedAtIso: base.submittedAtIso ?? null,
          includeOutcomeBanner: base.includeOutcomeBanner ?? true,
          gradedByLabel: base.gradedByLabel,
          approvedByLabel: base.approvedByLabel,
        };

  return renderLiveExamPdf({
    subtitleLines,
    questions,
    mode: args.mode,
    answers,
    answerKey,
    meta: metaPack,
    aiGradeJson: args.mode === "blank" ? null : args.aiGradeJson,
    brand: args.brand,
  });
}
