/**
 * Live exam: async-generated MCQs (unique per attempt) + drawn written prompts from the fill pool.
 * MCQs are not served from a static client-leakable bank.
 */
import type { ModQuestion, ModQuestionFill } from "@/app/lib/mod-assessment-types";
import { MASTER_FILL_BANK } from "@/app/lib/mod-assessment-pools/fill";
import { generateLiveMcqBatch, stableMcqBankKey } from "@/app/lib/mod-assessment-mcq-generate";

export const REALTIME_MCQ_COUNT = 20;
export const REALTIME_FILL_COUNT = 10;

function rngFromEntropy(entropy: string): () => number {
  let h = 5381 >>> 0;
  for (let i = 0; i < entropy.length; i++) {
    h = (Math.imul(33, h) ^ entropy.charCodeAt(i)) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 0xffffffff;
  };
}

function shuffle<T>(arr: T[], random: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function cloneFill(q: ModQuestionFill): ModQuestionFill {
  return {
    ...q,
    id: q.id,
  };
}

/** Prefer pool items least used on other users' in-flight live attempts; break ties randomly. */
function pickWithLowestOverlap<T extends { id: string }>(
  pool: T[],
  count: number,
  usage: Map<string, number> | undefined,
  rnd: () => number
): T[] {
  if (!usage || usage.size === 0) {
    const scratch = [...pool];
    shuffle(scratch, rnd);
    return scratch.slice(0, count);
  }

  const decorated = pool.map((item) => ({
    item,
    n: usage.get(item.id) ?? 0,
    tie: rnd(),
  }));
  decorated.sort((a, b) => a.n - b.n || a.tie - b.tie);
  return decorated.slice(0, count).map((d) => d.item);
}

export type LiveExamOverlapContext = {
  fillBankUsage: Map<string, number>;
  /** MCQ stems to avoid (concurrent exams + this candidate's recent failed live attempts). */
  avoidMcqPromptStems: string[];
};

/**
 * Returns exactly REALTIME_MCQ_COUNT freshly generated MCQs plus REALTIME_FILL_COUNT fill prompts,
 * shuffled together with per-attempt ids and stable bankKey for fills / hashed keys for MCQs.
 */
export async function buildRealtimeExamAsync(
  entropy: string,
  ctx?: LiveExamOverlapContext,
  onProgress?: (collected: number, total: number) => void
): Promise<ModQuestion[]> {
  const rnd = rngFromEntropy(entropy);

  if (MASTER_FILL_BANK.length < REALTIME_FILL_COUNT) {
    throw new Error(`Need at least ${REALTIME_FILL_COUNT} writing prompts in the pool.`);
  }

  const mcqPicked = await generateLiveMcqBatch({
    entropy,
    count: REALTIME_MCQ_COUNT,
    avoidPromptStems: ctx?.avoidMcqPromptStems ?? [],
    onProgress,
  });

  const fillScratch = MASTER_FILL_BANK.map(cloneFill);
  const fillPicked = pickWithLowestOverlap(
    fillScratch,
    REALTIME_FILL_COUNT,
    ctx?.fillBankUsage,
    rnd
  );

  const combined: ModQuestion[] = [...mcqPicked, ...fillPicked];
  shuffle(combined as ModQuestion[], rnd);

  const slug = entropy.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "ex";

  return combined.map((q, i) => {
    const newId = `${slug}-x${String(i + 1).padStart(2, "0")}`;
    if (q.type === "mcq") {
      const bankKey = stableMcqBankKey(q);
      return { ...q, id: newId, bankKey };
    }
    const bankKey = q.id;
    return { ...q, id: newId, bankKey };
  });
}
