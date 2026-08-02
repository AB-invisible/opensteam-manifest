/** Coerce `trial_tests.answers` JSON into a map usable for PDF / staff review (MCQ letters + written text). */
export function normalizeTrialAnswersJson(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string") continue;
    if (typeof v === "string") o[k] = v;
    else if (v != null && v !== undefined) o[k] = String(v).trim();
  }
  return o;
}
