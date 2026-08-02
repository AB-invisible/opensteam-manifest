import { modAssessmentChatCompletion } from "@/app/lib/mod-assessment-llm";

export type ApplicationAnswerRow = {
  questionId: string;
  title: string;
  value: string;
};

export type ApplicationAiGradeRow = {
  questionId: string;
  score: number; // 0..10
  rationale: string;
};

const SYSTEM = `You grade staff recruitment application answers.

You will receive a JSON payload: {"answers":[{"questionId":string,"title":string,"value":string}], "maxScorePerQuestion":10}

Return ONLY valid JSON:
{"grades":[{"questionId":string,"score":number,"rationale":string}]}

Rules:
- score is an INTEGER between 0 and maxScorePerQuestion inclusive.
- Grade each question independently based on relevance, completeness, clarity, and thoughtfulness.
- Empty/blank/"n/a" answers -> 0 (or 1 at most if it contains some minimal relevant info).
- Off-topic or evasive -> 0–2.
- Generic filler without specifics -> low (1–4).
- Solid, relevant, specific answer -> 6–9.
- Exceptional, detailed, well-reasoned, clearly structured -> 9–10.
- rationale: max 1 sentence, plain English, no markdown.`;

export async function gradeApplicationAnswers(opts: {
  answers: ApplicationAnswerRow[];
  maxScorePerQuestion?: number;
}): Promise<{ grades: ApplicationAiGradeRow[]; modelLabel: string }> {
  const max = Math.max(0, Math.min(10, Math.round(opts.maxScorePerQuestion ?? 10)));

  const payload = {
    answers: (opts.answers || []).map((a) => ({
      questionId: String(a.questionId ?? ""),
      title: String(a.title ?? ""),
      value: String(a.value ?? ""),
    })),
    maxScorePerQuestion: max,
  };

  const { content, label } = await modAssessmentChatCompletion({
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(payload) },
    ],
  });

  const parsed = JSON.parse(content) as { grades?: ApplicationAiGradeRow[] };
  const raw = Array.isArray(parsed?.grades) ? parsed.grades : [];

  const byId = new Map<string, ApplicationAiGradeRow>();
  for (const g of raw) {
    const questionId = String((g as any)?.questionId ?? "");
    if (!questionId) continue;
    const n = Number((g as any)?.score);
    const score = Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
    const rationale = typeof (g as any)?.rationale === "string" ? (g as any).rationale : "";
    byId.set(questionId, { questionId, score, rationale });
  }

  // Ensure stable ordering, include all questions even if model omitted some.
  const grades = (opts.answers || []).map((a) => {
    const id = String(a.questionId ?? "");
    const found = byId.get(id);
    if (found) return found;
    const v = String(a.value ?? "").trim();
    return { questionId: id, score: v ? 0 : 0, rationale: "" };
  });

  return { grades, modelLabel: label };
}

