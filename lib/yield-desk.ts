// lib/yield-desk.ts — the XRP Yield Desk data, read from xrplhub.io (same owner). xrplhub.io/yield builds and
// grades every option hourly (kreditkarma-backend src/lib/yieldDesk.ts) and publishes it as JSON at
// /api/yield/options. uxus sells the per-option grade as the $0.02 yield_grade API and MCP tool.
const XRPLHUB = "https://www.xrplhub.io";
export const YIELD_ID = /^[a-z0-9-]{3,90}$/;
const LIST_TTL_MS = 10 * 60_000;

let ids: { at: number; set: Set<string> } | null = null;

/** true / false, or null when xrplhub.io can't be reached (callers must not charge in that case). */
export async function yieldOptionExists(id: string): Promise<boolean | null> {
  if (!YIELD_ID.test(id)) return false;
  if (!ids || Date.now() - ids.at > LIST_TTL_MS || !ids.set.has(id)) {
    try {
      const r = await fetch(`${XRPLHUB}/api/yield/options`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (!r.ok) return ids ? ids.set.has(id) : null;
      const j = (await r.json()) as { options?: { slug: string }[] };
      ids = { at: Date.now(), set: new Set((j.options ?? []).map((o) => o.slug)) };
    } catch {
      return ids ? ids.set.has(id) : null;
    }
  }
  // Unlisted options (dropped by their source) still have a page and a grade; check them one by one.
  if (!ids.set.has(id)) {
    try {
      const r = await fetch(`${XRPLHUB}/api/yield/options?slug=${id}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      return r.status === 404 ? false : r.ok ? true : null;
    } catch {
      return null;
    }
  }
  return true;
}

export type YieldGradeBody = Record<string, unknown>;

/** The full grade for one option, or null if it doesn't exist. Throws when xrplhub.io can't be reached. */
export async function fetchYieldGrade(id: string): Promise<YieldGradeBody | null> {
  const r = await fetch(`${XRPLHUB}/api/yield/options?slug=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`xrplhub.io HTTP ${r.status}`);
  const j = (await r.json()) as {
    option: Record<string, unknown> & { gradeDetail: { grade: string; score: number; adjustments: unknown[]; methodVersion: string } };
    gradeHistory: unknown[];
    disclaimer: string;
    method: string;
  };
  const { gradeDetail, ...o } = j.option;
  return {
    id,
    ...o,
    grade: gradeDetail.grade,
    score: gradeDetail.score,
    adjustments: gradeDetail.adjustments,
    gradeHistory: j.gradeHistory,
    methodVersion: gradeDetail.methodVersion,
    method: j.method,
    disclaimer: j.disclaimer,
    checked_at: new Date().toISOString(),
  };
}
