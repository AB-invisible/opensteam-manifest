import type { ModQuestion, ModQuestionMcq } from "@/app/lib/mod-assessment-types";
import { EXEC_CATEGORY_MAP } from "@/app/lib/exec-categories";

/** Safe to send to the browser — no correct letters, no grading rubrics. */
export type PublicMcq = {
  id: string;
  type: "mcq";
  prompt: string;
  choices: ModQuestionMcq["choices"];
  category?: string;
  categoryLabel?: string;
};
export type PublicFill = {
  id: string;
  type: "fill";
  prompt: string;
  category?: string;
  categoryLabel?: string;
};
export type PublicQuestion = PublicMcq | PublicFill;

export function toPublicQuestions(questions: ModQuestion[]): PublicQuestion[] {
  return questions.map((q): PublicQuestion => {
    const cat = q.category;
    const categoryLabel = cat ? EXEC_CATEGORY_MAP[cat as keyof typeof EXEC_CATEGORY_MAP]?.label : undefined;
    if (q.type === "mcq") {
      return { id: q.id, type: "mcq", prompt: q.prompt, choices: q.choices, category: cat, categoryLabel };
    }
    return { id: q.id, type: "fill", prompt: q.prompt, category: cat, categoryLabel };
  });
}
