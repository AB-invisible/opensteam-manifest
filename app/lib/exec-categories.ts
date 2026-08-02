/**
 * Executive Officer exam — five category domains.
 *
 * Categories 1–4 are expertise areas (MCQ + written), each generated at its own difficulty tier.
 * Category 5 is a short professional fit block (5 written scenarios) — work-relevant only, never
 * personal-life probing. Per-category expertise PDFs are owner-only after submit.
 */
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq } from "@/app/lib/mod-assessment-types";

export type ExecDifficulty = "foundation" | "advanced" | "expert" | "executive";

export type ExecCategoryId =
  | "leadership"
  | "policy"
  | "crisis"
  | "operations"
  | "fit";

export type ExecCategoryDef = {
  id: ExecCategoryId;
  label: string;
  shortLabel: string;
  description: string;
  mcqCount: number;
  writtenCount: number;
  /** Target generation difficulty for this expertise block. */
  difficulty: ExecDifficulty;
  /** True for category 5 — fit/readiness only, not scored into the main MCQ pool. */
  isFit: boolean;
};

export const EXEC_CATEGORIES: ExecCategoryDef[] = [
  {
    id: "leadership",
    label: "Leadership & People",
    shortLabel: "Leadership",
    description:
      "Team direction, mentoring senior staff, conflict between moderators, performance conversations, and building trust under pressure.",
    mcqCount: 40,
    writtenCount: 9,
    difficulty: "expert",
    isFit: false,
  },
  {
    id: "policy",
    label: "Policy & Governance",
    shortLabel: "Policy",
    description:
      "Rule design, appeals oversight, audit trails, fairness, escalation policy, and defensible documentation standards.",
    mcqCount: 40,
    writtenCount: 9,
    difficulty: "executive",
    isFit: false,
  },
  {
    id: "crisis",
    label: "Crisis & Safety",
    shortLabel: "Crisis",
    description:
      "Raids, mass-report abuse, minor safety, doxxing, media/PR incidents, and rapid containment without reckless overreach.",
    mcqCount: 40,
    writtenCount: 9,
    difficulty: "expert",
    isFit: false,
  },
  {
    id: "operations",
    label: "Operations & Strategy",
    shortLabel: "Operations",
    description:
      "Staffing coverage, delegation, cross-team handoffs, tooling, metrics, burnout prevention, and sustainable mod-team operations.",
    mcqCount: 40,
    writtenCount: 8,
    difficulty: "advanced",
    isFit: false,
  },
  {
    id: "fit",
    label: "Executive Fit Assessment",
    shortLabel: "Fit",
    description:
      "Professional situational judgement — priorities, communication style under stress, and readiness for executive responsibility. Work-context only.",
    mcqCount: 0,
    writtenCount: 5,
    difficulty: "executive",
    isFit: true,
  },
];

export const EXEC_CATEGORY_MAP = Object.fromEntries(
  EXEC_CATEGORIES.map((c) => [c.id, c]),
) as Record<ExecCategoryId, ExecCategoryDef>;

export function execCategoryTotals() {
  let mcq = 0;
  let written = 0;
  for (const c of EXEC_CATEGORIES) {
    mcq += c.mcqCount;
    written += c.writtenCount;
  }
  return { mcq, written, total: mcq + written };
}

export function getExecCategory(id: string | null | undefined): ExecCategoryDef | null {
  if (!id) return null;
  return EXEC_CATEGORY_MAP[id as ExecCategoryId] ?? null;
}

/** Questions carry `category` on the JSON snapshot — group for UI / grading / PDFs. */
export function questionsByCategory(questions: ModQuestion[]): Map<ExecCategoryId, ModQuestion[]> {
  const map = new Map<ExecCategoryId, ModQuestion[]>();
  for (const c of EXEC_CATEGORIES) map.set(c.id, []);
  for (const q of questions) {
    const cat = (q as ModQuestion & { category?: string }).category as ExecCategoryId | undefined;
    if (cat && map.has(cat)) map.get(cat)!.push(q);
    else map.get("leadership")!.push(q); // legacy fallback
  }
  return map;
}

export type HandledLevel =
  | "below_expectation"
  | "developing"
  | "competent"
  | "strong"
  | "exceptional";

/** Maps a category score % to how the candidate handled that difficulty tier. */
export function scoreToHandledLevel(pct: number): HandledLevel {
  if (pct >= 90) return "exceptional";
  if (pct >= 75) return "strong";
  if (pct >= 60) return "competent";
  if (pct >= 40) return "developing";
  return "below_expectation";
}

export const HANDLED_LABELS: Record<HandledLevel, string> = {
  below_expectation: "Below expectation for this tier",
  developing: "Developing — partial mastery",
  competent: "Competent at this difficulty",
  strong: "Strong — handles this tier well",
  exceptional: "Exceptional — exceeds tier expectations",
};

export function difficultyPromptLine(d: ExecDifficulty): string {
  switch (d) {
    case "foundation":
      return "FOUNDATION tier: clear scenarios, one primary judgement call, moderately challenging distractors.";
    case "advanced":
      return "ADVANCED tier: multi-step situations, competing priorities, plausible wrong answers that tempt a rushed moderator.";
    case "expert":
      return "EXPERT tier: ambiguous edge cases, subtle policy nuance, distractors that sound senior but miss a critical safety or governance step.";
    case "executive":
      return "EXECUTIVE tier: organisation-wide stakes, reputational risk, mentoring vs autonomy tradeoffs, and decisions that set precedent for the whole team.";
  }
}

export function mcqSystemForCategory(cat: ExecCategoryDef): string {
  return `You write multiple-choice questions for the "${cat.label}" section of an Executive Officer exam (Head Moderator → executive leadership).

${difficultyPromptLine(cat.difficulty)}

Domain focus: ${cat.description}

Reply with JSON only:
{"questions":[{"prompt":"string","choices":{"A":"string","B":"string","C":"string","D":"string"},"correct":"A"}]}

"correct" must be A, B, C, or D. One realistic Discord moderation leadership situation per question. Plain clear English.`;
}

export function writtenSystemForCategory(cat: ExecCategoryDef, extraContext?: string): string {
  if (cat.isFit) {
    return `You write professional FIT-assessment prompts for an Executive Officer candidate. These evaluate leadership readiness in WORK CONTEXT ONLY.

STRICT RULES:
- Never ask about family, relationships, health, finances, religion, politics, or private life.
- Focus on: prioritisation under competing duties, giving hard feedback, ethical tradeoffs at scale, handling public criticism, and sustainable executive judgement.
- Each prompt is a short scenario requiring a multi-paragraph professional response.
${extraContext ? `\nContext from prior exam blocks (use only for scenario calibration, not personal inference):\n${extraContext}` : ""}

Reply with JSON only:
{"questions":[{"prompt":"string","rubric":"string"}]}

"rubric": what a strong executive-ready answer covers (0-10 grading guide).`;
  }

  return `You write written-answer questions for the "${cat.label}" section of an Executive Officer exam.

${difficultyPromptLine(cat.difficulty)}

Domain focus: ${cat.description}

Reply with JSON only:
{"questions":[{"prompt":"string","rubric":"string"}]}

"prompt": one realistic leadership situation requiring judgement and concrete steps.
"rubric": what a strong answer must cover for AI grading 0-10.`;
}

export function mcqSystemForCategoryWithDifficulty(cat: ExecCategoryDef, difficulty: ExecDifficulty): string {
  const line = difficultyPromptLine(difficulty);
  return `You write multiple-choice questions for the "${cat.label}" section of an Executive Officer exam (Head Moderator → executive leadership).

${line}

Domain focus: ${cat.description}

Reply with JSON only:
{"questions":[{"prompt":"string","choices":{"A":"string","B":"string","C":"string","D":"string"},"correct":"A"}]}

"correct" must be A, B, C, or D. One realistic Discord moderation leadership situation per question. Plain clear English.`;
}

export function writtenSystemForCategoryWithDifficulty(
  cat: ExecCategoryDef,
  difficulty: ExecDifficulty,
  extraContext?: string,
): string {
  const withDiff = { ...cat, difficulty };
  return writtenSystemForCategory(withDiff, extraContext);
}

export function categoryQuestionCounts(qs: ModQuestion[], catId: ExecCategoryId) {
  const items = qs.filter((q) => (q as ModQuestion & { category?: string }).category === catId);
  return {
    mcq: items.filter(isMcq).length,
    written: items.filter((q) => !isMcq(q)).length,
    total: items.length,
  };
}
