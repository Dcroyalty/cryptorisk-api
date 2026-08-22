// lib/scoring.ts — the 0-100 risk scoring engine.
// v1: bad-address lists (OFAC sanctions + scam) as hard signals,
// plus optional token-risk (GoPlus/Honeypot) added when available.

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Verdict = "PROCEED" | "CAUTION" | "BLOCK";

export interface Reason {
  code: string;
  severity: number;   // 0-10
  detail: string;
  source: string;
}

export interface RiskResult {
  address: string;
  chain: string;
  type: "wallet" | "token";
  risk_score: number;         // 0-100
  risk_level: RiskLevel;
  verdict: Verdict;
  flags: string[];
  reasons: Reason[];
  signals: Record<string, unknown>;
  sources: string[];
  checked_at: string;
  cache_ttl: number;
}

export function levelFromScore(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
export function verdictFromLevel(level: RiskLevel): Verdict {
  if (level === "low") return "PROCEED";
  if (level === "medium") return "CAUTION";
  return "BLOCK";
}

// Map a DB hit (source, category) to a scoring contribution.
export function scoreFromBadHits(hits: { source: string; category: string }[]) {
  let score = 0;
  const flags = new Set<string>();
  const reasons: Reason[] = [];
  const sources = new Set<string>();

  for (const h of hits) {
    sources.add(h.source);
    if (h.source === "ofac" || h.category === "sanctioned") {
      score = Math.max(score, 100);
      flags.add("SANCTIONED");
      reasons.push({ code: "SANCTIONED", severity: 10, detail: "Address appears on the OFAC SDN sanctions list", source: h.source });
    } else if (h.category === "scam") {
      score = Math.max(score, 90);
      flags.add("SCAM_LIST_MATCH");
      reasons.push({ code: "SCAM_LIST_MATCH", severity: 9, detail: `Address reported as malicious (${h.source})`, source: h.source });
    }
  }
  return { score, flags: [...flags], reasons, sources: [...sources] };
}

// Combine wallet-behavior signals (age/velocity) into the score.
export function applyWalletSignals(
  base: { score: number; flags: string[]; reasons: Reason[] },
  signals: { wallet_age_days?: number | null; tx_count?: number | null; is_contract?: boolean }
) {
  let { score } = base;
  const flags = new Set(base.flags);
  const reasons = [...base.reasons];

  const age = signals.wallet_age_days;
  const tx = signals.tx_count ?? 0;

  if (age != null && age < 7) {
    if (tx > 100) {
      score += 25; flags.add("NEW_WALLET"); flags.add("HIGH_VELOCITY");
      reasons.push({ code: "HIGH_VELOCITY", severity: 5, detail: "New wallet (<7d) with high transaction count", source: "behavior" });
    } else {
      score += 10; flags.add("NEW_WALLET");
      reasons.push({ code: "NEW_WALLET", severity: 3, detail: "Wallet is less than 7 days old", source: "behavior" });
    }
  } else if (age != null && age > 180 && base.score === 0) {
    score = Math.max(0, score - 10);
  }

  if (base.score === 0 && flags.size === 0) {
    flags.add("CLEAN");
    reasons.push({ code: "CLEAN", severity: 0, detail: "No sanctions or scam-list matches found", source: "cryptorisk" });
  }

  return { score: Math.min(100, Math.max(0, score)), flags: [...flags], reasons };
}
