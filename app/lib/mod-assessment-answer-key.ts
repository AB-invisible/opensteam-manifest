import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { isMcq } from "@/app/lib/mod-assessment-types";

/** Immutable snapshot of correct MCQ letters + rubrics for fills (stored on TrialTest.examAnswerKey). */
export type ExamAnswerKeyV1 = {
  v: 1;
  items: Array<
    | { id: string; kind: "mcq"; correct: "A" | "B" | "C" | "D"; points: number }
    | { id: string; kind: "fill"; rubricForAi: string; maxPoints: number }
  >;
};

export function buildExamAnswerKey(questions: ModQuestion[]): ExamAnswerKeyV1 {
  const items: ExamAnswerKeyV1["items"] = [];
  for (const q of questions) {
    if (isMcq(q)) {
      items.push({
        id: q.id,
        kind: "mcq",
        correct: q.correct,
        points: q.points ?? 10,
      });
    } else {
      items.push({
        id: q.id,
        kind: "fill",
        rubricForAi: q.rubricForAi,
        maxPoints: q.maxPoints,
      });
    }
  }
  return { v: 1, items };
}

export function resolveExamAnswerKey(
  examAnswerKeyJson: unknown,
  questions: ModQuestion[],
): ExamAnswerKeyV1 {
  if (
    examAnswerKeyJson &&
    typeof examAnswerKeyJson === "object" &&
    !Array.isArray(examAnswerKeyJson)
  ) {
    const o = examAnswerKeyJson as ExamAnswerKeyV1;
    if (o.v === 1 && Array.isArray(o.items)) return o;
  }
  return buildExamAnswerKey(questions);
}
