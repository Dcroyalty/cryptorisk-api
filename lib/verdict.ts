// lib/verdict.ts — one call, one verdict. Every risk response leads with:
//   verdict  PROCEED | CAUTION | BLOCK
//   summary  one sentence saying why, built from the strongest reasons
//   reasons  [{ code, severity 0-10, detail, source }], strongest first
// and keeps every older field after them (nothing removed; existing callers keep working).
import type { Reason, RiskResult, Verdict } from "@/lib/scoring";
import type { LiveRisk } from "@/lib/live-risk";

export const VERDICT_PRICE = "$0.02";
export const VERDICT_MEANING = {
  PROCEED: "No sanctions, scam-list or risk signal found. Go ahead.",
  CAUTION: "A warning sign, or a data source could not be checked. Look at the reasons before you send funds.",
  BLOCK: "Sanctioned, on a scam list, or a high-risk signal. Do not send funds.",
} as const;

const byStrength = (a: Reason, b: Reason) => b.severity - a.severity;

function summarize(verdict: Verdict, reasons: Reason[], degraded: boolean): string {
  const top = reasons.filter((r) => r.severity > 0).slice(0, 2).map((r) => r.detail.replace(/\.$/, ""));
  if (verdict === "PROCEED") return top.length ? `PROCEED: no blocking signal (${top.join("; ")}).` : "PROCEED: no sanctions, scam-list or risk signal found.";
  if (degraded && !top.length) return "CAUTION: a data source could not be checked, so this address was not fully assessed. Retry before acting.";
  return `${verdict}: ${top.join("; ") || VERDICT_MEANING[verdict]}.`;
}

/** /api/risk/pro and /api/risk/bazaar: the full report, verdict first. */
export function verdictFirst(r: RiskResult) {
  const reasons = [...r.reasons].sort(byStrength);
  const { verdict, reasons: _r, ...rest } = r;
  return { verdict, summary: summarize(verdict, reasons, r.degraded), reasons, ...rest, verdict_meaning: VERDICT_MEANING[verdict] };
}

// ── live (mutable) token risk: map the hold scale onto PROCEED / CAUTION / BLOCK ─────────────────────────────────
const LIVE_TO_VERDICT: Record<LiveRisk["verdict"], Verdict> = { SAFE_TO_HOLD: "PROCEED", MONITOR: "CAUTION", EXIT_RISK: "BLOCK", DO_NOT_HOLD: "BLOCK" };
const POWER_SEVERITY: Record<string, number> = {
  CURRENTLY_PAUSED_TRANSFERS_BLOCKED: 9, OWNER_CAN_REPLACE_ALL_CONTRACT_LOGIC: 8, PROXY_ADMIN_ACTIVE: 6, OWNER_CAN_PAUSE_ALL_TRANSFERS: 6,
  OWNERSHIP_TRANSFER_PENDING: 5, RPC_UNAVAILABLE_RESULT_UNKNOWN: 5, PARTIAL_READ_RESULT_UNKNOWN: 5, OWNER_RETAINS_PRIVILEGES: 4,
  CONTROLS_LOCKED: 0, NOT_A_CONTRACT: 0,
};
export function liveVerdict(r: LiveRisk): Verdict { return LIVE_TO_VERDICT[r.verdict]; }
export function liveVerdictFirst(r: LiveRisk, explain: Record<string, string>) {
  const verdict = liveVerdict(r);
  const unknown = r.powers.some((p) => p.endsWith("_RESULT_UNKNOWN"));
  const reasons: Reason[] = r.powers.map((p) => ({ code: p, severity: POWER_SEVERITY[p] ?? 5, detail: explain[p] ?? p, source: "onchain" })).sort(byStrength);
  const { verdict: hold, ...rest } = r;
  return { verdict, summary: summarize(verdict, reasons, unknown), reasons, hold_verdict: hold, ...rest, verdict_meaning: VERDICT_MEANING[verdict] };
}
