import { createHash } from "crypto";
import type { ModQuestionMcq } from "@/app/lib/mod-assessment-types";
import { modAssessmentChatCompletion } from "@/app/lib/mod-assessment-llm";

const MCQ_POINTS = 3;

/** Smaller prompts + chunked generation keep Groq on-demand requests under TPM / per-call limits. */
const MCQ_BATCH_SIZE = 5;
const MAX_AVOID_STEMS_IN_REQUEST = 12;
const AVOID_STEM_CHARS = 100;
const BATCH_MAX_TOKENS = 4400;
const BETWEEN_BATCH_MS = 1600;

const MCQ_GENERATOR_SYSTEM = `You write multiple-choice questions for people moderating Discord and support tickets.

Reply with JSON only:
{"questions":[{"prompt":"string","choices":{"A":"string","B":"string","C":"string","D":"string"},"correct":"A"}]}

Style: normal everyday English—short and clear, like how mods actually talk. No stiff legal tone, no buzzwords, no long formal openings. One simple situation per question.

"correct" must be A, B, C, or D. Wrong answers should sound believable but be clearly worse than the best one.

Topics (examples): tickets, escalation, saving proof, cooling down drama, raids, appeals, staff channels, safety, handoffs.`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJsonObject(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return t.trim();
}

function normalizePromptKey(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 96);
}

export function stableMcqBankKey(q: Pick<ModQuestionMcq, "prompt" | "correct" | "choices">): string {
  const norm = `${q.prompt}|${q.correct}|${q.choices.A}|${q.choices.B}|${q.choices.C}|${q.choices.D}`
    .replace(/\s+/g, " ")
    .trim();
  return `gen:${createHash("sha256").update(norm).digest("hex").slice(0, 24)}`;
}

function validateOne(raw: unknown): ModQuestionMcq | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prompt = typeof o.prompt === "string" ? o.prompt.replace(/\s+/g, " ").trim() : "";
  const correctRaw = typeof o.correct === "string" ? o.correct.trim().toUpperCase() : "";
  const ch = o.choices;
  if (!ch || typeof ch !== "object" || Array.isArray(ch)) return null;
  const c = ch as Record<string, unknown>;
  const A = typeof c.A === "string" ? c.A.replace(/\s+/g, " ").trim() : "";
  const B = typeof c.B === "string" ? c.B.replace(/\s+/g, " ").trim() : "";
  const C = typeof c.C === "string" ? c.C.replace(/\s+/g, " ").trim() : "";
  const D = typeof c.D === "string" ? c.D.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 20 || prompt.length > 1200) return null;
  if (!["A", "B", "C", "D"].includes(correctRaw)) return null;
  const letters = [A, B, C, D];
  if (letters.some((x) => x.length < 4 || x.length > 320)) return null;
  const set = new Set(letters.map((x) => x.toLowerCase()));
  if (set.size !== 4) return null;

  return {
    id: "pending-mcq",
    type: "mcq",
    points: MCQ_POINTS,
    prompt,
    choices: { A, B, C, D },
    correct: correctRaw as ModQuestionMcq["correct"],
  };
}

function dedupeByPrompt(items: ModQuestionMcq[]): ModQuestionMcq[] {
  const seen = new Set<string>();
  const out: ModQuestionMcq[] = [];
  for (const q of items) {
    const k = normalizePromptKey(q.prompt);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/** Merge external avoid list + stems from questions already generated this session (deduped, capped). */
function buildAvoidStems(base: string[], generated: ModQuestionMcq[]): string[] {
  const fromQs = generated.map((q) => q.prompt.replace(/\s+/g, " ").trim().slice(0, AVOID_STEM_CHARS));
  const merged = [...base, ...fromQs].map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of merged) {
    const sig = s.slice(0, 40).toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(s.slice(0, AVOID_STEM_CHARS));
    if (out.length >= 32) break;
  }
  return out.slice(0, MAX_AVOID_STEMS_IN_REQUEST);
}

async function requestMcqPack(args: {
  count: number;
  entropy: string;
  avoidStems: string[];
  temperature: number;
  maxOutputTokens: number;
  systemPrompt?: string;
}): Promise<ModQuestionMcq[]> {
  const avoidBullets =
    args.avoidStems.length > 0
      ? args.avoidStems.slice(0, MAX_AVOID_STEMS_IN_REQUEST).map((s, i) => `${i + 1}. ${s.slice(0, AVOID_STEM_CHARS)}`)
      : [];

  const userPayload = {
    count: args.count,
    sessionEntropy: args.entropy,
    instruction:
      "Put exactly this many items in questions[]. Keep wording plain and short. Do not reuse or closely copy avoidQuestionStems; write new situations.",
    avoidQuestionStems: avoidBullets.length > 0 ? avoidBullets : [],
  };

  const { content: txt } = await modAssessmentChatCompletion({
    temperature: args.temperature,
    max_tokens: args.maxOutputTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: args.systemPrompt ?? MCQ_GENERATOR_SYSTEM },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(txt));
  } catch {
    throw new Error("MCQ model returned non-JSON.");
  }

  const root = parsed as { questions?: unknown };
  if (!Array.isArray(root.questions)) throw new Error("MCQ JSON missing questions array.");

  const out: ModQuestionMcq[] = [];
  for (const item of root.questions) {
    const v = validateOne(item);
    if (v) out.push(v);
  }
  return dedupeByPrompt(out);
}

/**
 * Produces fresh MCQs for one live exam (not from a static pool), so prior attempts / leaked banks cannot predict items.
 * Uses several small API calls (Groq on-demand TPM) instead of one very large completion.
 * Accumulates across all batches and retry rounds (partial batches no longer wipe progress).
 */
export async function generateLiveMcqBatch(args: {
  entropy: string;
  count: number;
  avoidPromptStems: string[];
  onProgress?: (collected: number, total: number) => void;
  /** Optional override for the generator system prompt (e.g. harder promotional difficulty). */
  systemPrompt?: string;
}): Promise<ModQuestionMcq[]> {
  const avoidBase = [...args.avoidPromptStems].map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

  let collected: ModQuestionMcq[] = [];

  for (let round = 0; round < 5 && collected.length < args.count; round++) {
    const temperature = Math.min(0.88, 0.66 + round * 0.045);
    const remaining = args.count - collected.length;
    const nBatches = Math.ceil(remaining / MCQ_BATCH_SIZE);

    for (let b = 0; b < nBatches && collected.length < args.count; b++) {
      const need = Math.min(MCQ_BATCH_SIZE, args.count - collected.length);
      if (need <= 0) break;

      const avoidForCall = buildAvoidStems(avoidBase, collected);
      const pack = await requestMcqPack({
        count: need,
        entropy: `${args.entropy}:r${round}:b${b}`,
        avoidStems: avoidForCall,
        temperature,
        maxOutputTokens: BATCH_MAX_TOKENS,
        systemPrompt: args.systemPrompt,
      });

      collected = dedupeByPrompt([...collected, ...pack]);
      if (args.onProgress) {
        args.onProgress(collected.length, args.count);
      }

      if (collected.length >= args.count) {
        return collected.slice(0, args.count);
      }

      if (b < nBatches - 1 && collected.length < args.count) {
        await sleep(BETWEEN_BATCH_MS);
      }
    }

    if (collected.length < args.count && round < 4) {
      await sleep(BETWEEN_BATCH_MS);
    }
  }

  throw new Error(
    `Could not generate enough valid MCQs (got ${collected.length}, need ${args.count}). Try again in a minute or upgrade Groq tier.`
  );
}
