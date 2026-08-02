/**
 * Builds a promotional rank exam: a harder ABCD multiple-choice section followed by a written
 * ("typing") section, both generated live per attempt. Sections are kept in order (MCQ first,
 * then written) — never cross-shuffled — so the two timed sections map cleanly to question ranges.
 */
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { generateLiveMcqBatch, stableMcqBankKey } from "@/app/lib/mod-assessment-mcq-generate";
import { generatePromoFillBatch, stableFillBankKey } from "@/app/lib/promo-fill-generate";
import type { PromoExamOverlapContext } from "@/app/lib/promo-exam-service";
import type { PromoTier } from "@/app/lib/promo-tiers";

const PROMO_MCQ_SYSTEM = `You write HARD multiple-choice questions for experienced Discord moderators being promoted to a senior rank.

Reply with JSON only:
{"questions":[{"prompt":"string","choices":{"A":"string","B":"string","C":"string","D":"string"},"correct":"A"}]}

Make them genuinely challenging: ambiguous edge cases, competing priorities (safety vs optics, escalation vs handling it solo), policy nuance, raids, mass-report handling, appeals, evidence/logging standards, mentoring junior staff. One realistic situation per question, plain clear English.

"correct" must be A, B, C, or D. The distractors must be plausible to a real moderator and only subtly worse than the best answer — avoid obviously wrong throwaway options.`;

export type PromoExamSection = "mcq" | "fill";

/** Builds the promo exam for a tier; reports combined generation progress across both sections. */
export async function buildPromoExamAsync(
  tier: PromoTier,
  entropy: string,
  ctx?: PromoExamOverlapContext,
  onProgress?: (collected: number, total: number) => void,
): Promise<ModQuestion[]> {
  const total = tier.mcqCount + tier.fillCount;

  const mcqPicked = await generateLiveMcqBatch({
    entropy: `${entropy}:mcq`,
    count: tier.mcqCount,
    avoidPromptStems: ctx?.avoidMcqPromptStems ?? [],
    systemPrompt: PROMO_MCQ_SYSTEM,
    onProgress: (collected) => onProgress?.(collected, total),
  });

  const fillPicked = await generatePromoFillBatch({
    entropy: `${entropy}:fill`,
    count: tier.fillCount,
    avoidPromptStems: ctx?.avoidFillPromptStems ?? [],
    onProgress: (collected) => onProgress?.(tier.mcqCount + collected, total),
  });

  // MCQ section first, then written section — preserved order for per-section timers.
  const ordered: ModQuestion[] = [...mcqPicked, ...fillPicked];
  const slug = entropy.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "promo";

  return ordered.map((q, i) => {
    const newId = `${slug}-q${String(i + 1).padStart(2, "0")}`;
    if (q.type === "mcq") {
      return { ...q, id: newId, bankKey: stableMcqBankKey(q) };
    }
    return { ...q, id: newId, bankKey: stableFillBankKey(q.prompt, q.rubricForAi) };
  });
}
