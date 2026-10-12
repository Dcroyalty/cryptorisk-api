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
  CAUTION: "A warning sign (such as owner or issuer controls), or a data source could not be checked. Look at the reasons before you send funds.",
  BLOCK: "Sanctioned, on a scam list, or a hard red flag. Do not send funds.",
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
// Admin powers on their own (owner, pause switch, upgradeable proxy) are CAUTION, however many stack up: plenty of
// legitimate tokens have them. BLOCK is kept for sanctions hits, known scams and hard red flags; on this route the
// only hard red flag is transfers being paused right now. The old hold scale still goes out as hold_verdict.
const HARD_RED_FLAGS = new Set(["CURRENTLY_PAUSED_TRANSFERS_BLOCKED"]);
const POWER_SEVERITY: Record<string, number> = {
  CURRENTLY_PAUSED_TRANSFERS_BLOCKED: 9, OWNER_CAN_REPLACE_ALL_CONTRACT_LOGIC: 8, PROXY_ADMIN_ACTIVE: 6, OWNER_CAN_PAUSE_ALL_TRANSFERS: 6,
  OWNERSHIP_TRANSFER_PENDING: 5, RPC_UNAVAILABLE_RESULT_UNKNOWN: 5, PARTIAL_READ_RESULT_UNKNOWN: 5, OWNER_RETAINS_PRIVILEGES: 4,
  CONTROLS_LOCKED: 0, NOT_A_CONTRACT: 0,
};

// Regulated, issuer-run stablecoins. Freeze, pause and upgrade powers are how these are meant to work, so the
// verdict says that in plain words instead of reading like a rug setup. Keyed `${chain}:${address}`, lowercase.
const REGULATED_STABLECOINS: Record<string, string> = {
  "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "ethereum:0x1abaea1f7c830bd89acc67ec4af516284b1bc33c": "EURC",
  "base:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": "EURC",
  "ethereum:0x8292bb45bf1ee4d140127049757c2e0ff06317ed": "RLUSD",
  "ethereum:0x6c3ea9036406852006290770bedfcaba0e23a0e8": "PYUSD",
  "ethereum:0x8e870d67f660d95d5be530380d0ec0bd388289e1": "USDP",
  "ethereum:0x056fd409e1d7a124bd7017459dfea2f387b6d5cd": "GUSD",
};
const ISSUER_CONTROLS = "issuer can freeze or upgrade; normal for regulated stablecoins";

export function liveVerdict(r: LiveRisk): Verdict {
  if (r.powers.some((p) => HARD_RED_FLAGS.has(p))) return "BLOCK";
  return r.verdict === "SAFE_TO_HOLD" ? "PROCEED" : "CAUTION";
}
export function liveVerdictFirst(r: LiveRisk, explain: Record<string, string>) {
  const verdict = liveVerdict(r);
  const unknown = r.powers.some((p) => p.endsWith("_RESULT_UNKNOWN"));
  const reasons: Reason[] = r.powers.map((p) => ({ code: p, severity: POWER_SEVERITY[p] ?? 5, detail: explain[p] ?? p, source: "onchain" })).sort(byStrength);
  let summary = summarize(verdict, reasons, unknown);
  const stablecoin = REGULATED_STABLECOINS[`${r.chain}:${r.address}`];
  if (stablecoin && verdict === "CAUTION" && !unknown) {
    // Leads the list at the strength of the powers it sums up, so reasons[] stays strongest first.
    reasons.unshift({ code: "REGULATED_STABLECOIN_ISSUER_CONTROLS", severity: reasons[0]?.severity ?? 4, detail: `${stablecoin}: ${ISSUER_CONTROLS}.`, source: "uxus" });
    summary = `CAUTION: ${ISSUER_CONTROLS}.`;
  }
  const { verdict: hold, ...rest } = r;
  return { verdict, summary, reasons, hold_verdict: hold, ...rest, verdict_meaning: VERDICT_MEANING[verdict] };
}
