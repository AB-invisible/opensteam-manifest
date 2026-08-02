/**
 * AI generation of written ("typing") promotion-exam questions. The static fill pool is far too
 * small for 35-50 prompts per attempt, so these are generated fresh per attempt (batched to stay
 * under Groq per-call limits), mirroring the MCQ generator. Each item carries an AI grading rubric.
 */
import { createHash } from "crypto";
import type { ModQuestionFill } from "@/app/lib/mod-assessment-types";
import { modAssessmentChatCompletion } from "@/app/lib/mod-assessment-llm";

const FILL_POINTS = 10;
const FILL_BATCH_SIZE = 4;
const MAX_AVOID_STEMS_IN_REQUEST = 10;
const AVOID_STEM_CHARS = 100;
const BATCH_MAX_TOKENS = 4200;
const BETWEEN_BATCH_MS = 1600;

const FILL_GENERATOR_SYSTEM = `You write hard, scenario-based written-answer questions for SENIOR Discord moderators being promoted.

Reply with JSON only:
{"questions":[{"prompt":"string","rubric":"string"}]}

These are harder than entry-level mod questions: messy, ambiguous situations with competing priorities (safety vs optics, escalation vs autonomy, conflicting staff, repeat offenders, cross-server raids, appeals, ticket triage under load, mentoring junior staff, policy edge cases).

"prompt": one realistic situation that requires judgement and a multi-step answer. Plain, clear English. No multiple choice.
"rubric": what a strong answer must cover so an AI grader can score it 0-${FILL_POINTS} — list the key safe actions, escalation/logging steps, and reasoning a great senior moderator would include.`;

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

export function stableFillBankKey(prompt: string, rubric: string): string {
  const norm = `${prompt}|${rubric}`.replace(/\s+/g, " ").trim();
  return `genfill:${createHash("sha256").update(norm).digest("hex").slice(0, 24)}`;
}

function validateOne(raw: unknown): ModQuestionFill | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prompt = typeof o.prompt === "string" ? o.prompt.replace(/\s+/g, " ").trim() : "";
  const rubric = typeof o.rubric === "string" ? o.rubric.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 30 || prompt.length > 1400) return null;
  if (rubric.length < 20 || rubric.length > 1400) return null;
  return {
    id: "pending-fill",
    type: "fill",
    prompt,
    rubricForAi: rubric,
    maxPoints: FILL_POINTS,
  };
}

function dedupeByPrompt(items: ModQuestionFill[]): ModQuestionFill[] {
  const seen = new Set<string>();
  const out: ModQuestionFill[] = [];
  for (const q of items) {
    const k = normalizePromptKey(q.prompt);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

function buildAvoidStems(base: string[], generated: ModQuestionFill[]): string[] {
  const fromQs = generated.map((q) => q.prompt.replace(/\s+/g, " ").trim().slice(0, AVOID_STEM_CHARS));
  const merged = [...base, ...fromQs].map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of merged) {
    const sig = s.slice(0, 40).toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(s.slice(0, AVOID_STEM_CHARS));
    if (out.length >= 28) break;
  }
  return out.slice(0, MAX_AVOID_STEMS_IN_REQUEST);
}

async function requestFillPack(args: {
  count: number;
  entropy: string;
  avoidStems: string[];
  temperature: number;
  systemPrompt?: string;
}): Promise<ModQuestionFill[]> {
  const avoidBullets =
    args.avoidStems.length > 0
      ? args.avoidStems.slice(0, MAX_AVOID_STEMS_IN_REQUEST).map((s, i) => `${i + 1}. ${s.slice(0, AVOID_STEM_CHARS)}`)
      : [];

  const userPayload = {
    count: args.count,
    sessionEntropy: args.entropy,
    instruction:
      "Put exactly this many items in questions[]. Each must be a hard senior-moderator scenario with a clear grading rubric. Do not reuse or closely copy avoidQuestionStems; write new situations.",
    avoidQuestionStems: avoidBullets,
  };

  const { content: txt } = await modAssessmentChatCompletion({
    temperature: args.temperature,
    max_tokens: BATCH_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: args.systemPrompt ?? FILL_GENERATOR_SYSTEM },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(txt));
  } catch {
    throw new Error("Fill model returned non-JSON.");
  }

  const root = parsed as { questions?: unknown };
  if (!Array.isArray(root.questions)) throw new Error("Fill JSON missing questions array.");

  const out: ModQuestionFill[] = [];
  for (const item of root.questions) {
    const v = validateOne(item);
    if (v) out.push(v);
  }
  return dedupeByPrompt(out);
}

/** Produces fresh written prompts for one promo exam — batched, retried, accumulated. */
export async function generatePromoFillBatch(args: {
  entropy: string;
  count: number;
  avoidPromptStems: string[];
  onProgress?: (collected: number, total: number) => void;
  systemPrompt?: string;
}): Promise<ModQuestionFill[]> {
  const avoidBase = [...args.avoidPromptStems].map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

  let collected: ModQuestionFill[] = [];

  for (let round = 0; round < 5 && collected.length < args.count; round++) {
    const temperature = Math.min(0.92, 0.7 + round * 0.045);
    const remaining = args.count - collected.length;
    const nBatches = Math.ceil(remaining / FILL_BATCH_SIZE);

    for (let b = 0; b < nBatches && collected.length < args.count; b++) {
      const need = Math.min(FILL_BATCH_SIZE, args.count - collected.length);
      if (need <= 0) break;

      const avoidForCall = buildAvoidStems(avoidBase, collected);
      const pack = await requestFillPack({
        count: need,
        entropy: `${args.entropy}:r${round}:b${b}`,
        avoidStems: avoidForCall,
        temperature,
        systemPrompt: args.systemPrompt,
      });

      collected = dedupeByPrompt([...collected, ...pack]);
      if (args.onProgress) args.onProgress(collected.length, args.count);

      if (collected.length >= args.count) return collected.slice(0, args.count);

      if (b < nBatches - 1 && collected.length < args.count) {
        await sleep(BETWEEN_BATCH_MS);
      }
    }

    if (collected.length < args.count && round < 4) await sleep(BETWEEN_BATCH_MS);
  }

  throw new Error(
    `Could not generate enough written prompts (got ${collected.length}, need ${args.count}). Try again shortly.`,
  );
}
