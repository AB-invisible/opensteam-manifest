/**
 * Builds Executive Officer exam categories — one block at a time for adaptive difficulty.
 *
 * Category 1 starts at its configured tier. Each subsequent expertise category is generated
 * after the prior block is completed, at a difficulty adjusted from how the candidate handled it.
 * Category 5 (fit) is always last and uses a professional performance summary only.
 */
import type { ModQuestion } from "@/app/lib/mod-assessment-types";
import { generateLiveMcqBatch, stableMcqBankKey } from "@/app/lib/mod-assessment-mcq-generate";
import { generatePromoFillBatch, stableFillBankKey } from "@/app/lib/promo-fill-generate";
import type { PromoExamOverlapContext } from "@/app/lib/promo-exam-service";
import {
  EXEC_CATEGORIES,
  mcqSystemForCategoryWithDifficulty,
  writtenSystemForCategoryWithDifficulty,
  writtenSystemForCategory,
  execCategoryTotals,
  type ExecCategoryDef,
  type ExecCategoryId,
  type ExecDifficulty,
} from "@/app/lib/exec-categories";
import { fitGenerationContext, type ExecCategoryProgress } from "@/app/lib/exec-adaptive";

async function generateCategoryMcq(
  cat: ExecCategoryDef,
  difficulty: ExecDifficulty,
  entropy: string,
  avoidStems: string[],
  count: number,
): Promise<ModQuestion[]> {
  if (count <= 0) return [];
  const picked = await generateLiveMcqBatch({
    entropy: `${entropy}:${cat.id}:mcq`,
    count,
    avoidPromptStems: avoidStems,
    systemPrompt: mcqSystemForCategoryWithDifficulty(cat, difficulty),
  });
  return picked.map((q) => ({
    ...q,
    category: cat.id,
    difficulty,
  }));
}

async function generateCategoryWritten(
  cat: ExecCategoryDef,
  difficulty: ExecDifficulty,
  entropy: string,
  avoidStems: string[],
  count: number,
  fitContext?: string,
): Promise<ModQuestion[]> {
  if (count <= 0) return [];
  const systemPrompt = cat.isFit
    ? writtenSystemForCategory(cat, fitContext)
    : writtenSystemForCategoryWithDifficulty(cat, difficulty);
  const picked = await generatePromoFillBatch({
    entropy: `${entropy}:${cat.id}:fill`,
    count,
    avoidPromptStems: avoidStems,
    systemPrompt,
  });
  return picked.map((q) => ({
    ...q,
    category: cat.id,
    difficulty,
  }));
}

function remapIds(
  questions: ModQuestion[],
  slug: string,
  startIndex: number,
): ModQuestion[] {
  return questions.map((q, i) => {
    const newId = `${slug}-${q.category}-q${String(startIndex + i + 1).padStart(3, "0")}`;
    if (q.type === "mcq") {
      return { ...q, id: newId, bankKey: stableMcqBankKey(q) };
    }
    return { ...q, id: newId, bankKey: stableFillBankKey(q.prompt, q.rubricForAi) };
  });
}

/** Generate a single category block at the given difficulty tier. */
export async function buildExecCategoryAsync(
  categoryId: ExecCategoryId,
  difficulty: ExecDifficulty,
  entropy: string,
  ctx?: PromoExamOverlapContext,
  progress?: ExecCategoryProgress,
  onProgress?: (collected: number, total: number) => void,
): Promise<ModQuestion[]> {
  const cat = EXEC_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) throw new Error(`Unknown category: ${categoryId}`);

  const total = cat.mcqCount + cat.writtenCount;
  const avoidMcq = [...(ctx?.avoidMcqPromptStems ?? [])];
  const avoidFill = [...(ctx?.avoidFillPromptStems ?? [])];
  const fitContext = cat.isFit && progress ? fitGenerationContext(progress) : undefined;

  const mcq = await generateCategoryMcq(cat, difficulty, entropy, avoidMcq, cat.mcqCount);
  onProgress?.(mcq.length, total);
  avoidMcq.push(...mcq.map((q) => q.prompt.slice(0, 120)));

  const fill = await generateCategoryWritten(
    cat,
    difficulty,
    entropy,
    avoidFill,
    cat.writtenCount,
    fitContext,
  );
  onProgress?.(mcq.length + fill.length, total);

  const slug = entropy.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "exec";
  return remapIds([...mcq, ...fill], slug, 0);
}

/** Legacy: build all categories at once (used only if needed for migration). */
export async function buildExecExamAsync(
  entropy: string,
  ctx?: PromoExamOverlapContext,
  onProgress?: (collected: number, total: number) => void,
): Promise<ModQuestion[]> {
  const { total } = execCategoryTotals();
  let collected = 0;
  const bump = (n: number) => {
    collected += n;
    onProgress?.(collected, total);
  };

  const ordered: ModQuestion[] = [];
  for (const cat of EXEC_CATEGORIES) {
    const block = await buildExecCategoryAsync(cat.id, cat.difficulty, entropy, ctx);
    bump(block.length);
    ordered.push(...block.map((q, i) => ({ ...q, id: q.id.replace(/q\d{3}$/, `q${String(ordered.length + i + 1).padStart(3, "0")}`) })));
  }
  return ordered;
}

/** Append new category questions with continuous numbering after existing paper. */
export function appendCategoryQuestions(
  existing: ModQuestion[],
  newBlock: ModQuestion[],
  slug: string,
): ModQuestion[] {
  const startIndex = existing.length;
  return [...existing, ...remapIds(newBlock, slug, startIndex)];
}

export { execCategoryTotals };
