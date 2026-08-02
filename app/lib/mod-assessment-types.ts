/** Executive Officer exam — expertise / fit category id on each question. */
export type ExecQuestionMeta = {
  category?: string;
  difficulty?: "foundation" | "advanced" | "expert" | "executive";
};

/** Multiple choice — A/B/C/D. */
export type ModQuestionMcq = {
  id: string;
  /** Stable pool id (e.g. discord-mcq-12); kept when attempt `id` is remapped per session. */
  bankKey?: string;
  type: "mcq";
  prompt: string;
  choices: { A: string; B: string; C: string; D: string };
  /** Correct letter */
  correct: "A" | "B" | "C" | "D";
  points?: number;
} & ExecQuestionMeta;

/** Free response — graded by AI using rubric, then awaits staff confirmation. */
export type ModQuestionFill = {
  id: string;
  /** Stable pool id (e.g. ticket-w-03); kept when attempt `id` is remapped per session. */
  bankKey?: string;
  type: "fill";
  prompt: string;
  /** Instructions for AI — what a good answer covers */
  rubricForAi: string;
  maxPoints: number;
} & ExecQuestionMeta;

export type ModQuestion = ModQuestionMcq | ModQuestionFill;

export function isMcq(q: ModQuestion): q is ModQuestionMcq {
  return q.type === "mcq";
}

export function parseQuestions(json: unknown): ModQuestion[] {
  if (!Array.isArray(json)) return [];
  return json as ModQuestion[];
}

export function totalMaxPoints(questions: ModQuestion[]): number {
  let n = 0;
  for (const q of questions) {
    n += isMcq(q) ? q.points ?? 10 : q.maxPoints;
  }
  return n;
}
