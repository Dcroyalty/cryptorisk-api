import { sql } from "@/lib/db";
import { getWalletSignals, getTokenRisk } from "@/lib/sources";
import { RISK_DISCLAIMER } from "@/lib/disclaimer";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/arc";
import {
  scoreFromBadHits, applyWalletSignals, levelFromScore, verdictFromLevel,
  type RiskResult, type Reason,
} from "@/lib/scoring";

// arc: placeholder testnet chain id, only used for the GoPlus token-risk
// lookup (type=token). GoPlus almost certainly won't index Arc at launch —
// that call degrades gracefully already (returns null -> TOKEN_CHECK_UNAVAILABLE).
// Update once GoPlus confirms Arc support; doesn't block wallet screening.
const CHAIN_IDS: Record<string, number> = { ethereum: 1, base: 8453, arc: ARC_TESTNET_CHAIN_ID };
export const SUPPORTED_CHAINS = Object.keys(CHAIN_IDS);
export function chainId(chain: string) { return CHAIN_IDS[chain]; }

export async function scoreAddress(address: string, chain: string, type: "wallet" | "token"): Promise<RiskResult> {
  const hits = await sql`SELECT source, category FROM bad_addresses WHERE address = ${address}` as { source: string; category: string }[];
  const bad = scoreFromBadHits(hits);

  let score = bad.score;
  let flags = [...bad.flags];
  let reasons: Reason[] = [...bad.reasons];
  // sources = the lists that actually matched this address, not the lists consulted.
  const sources = new Set<string>(bad.sources);
  let signals: Record<string, unknown> = {};
  // true = an input needed for the verdict was unavailable and there was no list
  // hit — the verdict is "not fully assessed", never PROCEED/CLEAN.
  let degraded = false;

  if (type === "token") {
    const t = await getTokenRisk(address, CHAIN_IDS[chain]);
    if (t) {
      sources.add("goplus");
      const honeypot = t.is_honeypot === "1";
      const sellTax = parseFloat(t.sell_tax || "0");
      const mintable = t.is_mintable === "1";
      const hiddenOwner = t.hidden_owner === "1";
      const notOpen = t.is_open_source === "0";
      if (honeypot) { score = Math.max(score, 90); flags.push("HONEYPOT"); reasons.push({ code: "HONEYPOT", severity: 10, detail: "Token simulates as a honeypot (cannot sell)", source: "goplus" }); }
      if (sellTax > 0.10) { score += 20; flags.push("HIGH_SELL_TAX"); reasons.push({ code: "HIGH_SELL_TAX", severity: 6, detail: "High sell tax", source: "goplus" }); }
      if (mintable) { score += 15; flags.push("MINTABLE"); reasons.push({ code: "MINTABLE", severity: 5, detail: "Token supply is mintable by owner", source: "goplus" }); }
      if (hiddenOwner) { score += 20; flags.push("HIDDEN_OWNER"); reasons.push({ code: "HIDDEN_OWNER", severity: 7, detail: "Contract has a hidden owner", source: "goplus" }); }
      if (notOpen) { score += 10; flags.push("UNVERIFIED_CONTRACT"); reasons.push({ code: "UNVERIFIED_CONTRACT", severity: 4, detail: "Contract source is not verified/open", source: "goplus" }); }
      signals = { holder_count: t.holder_count, buy_tax: t.buy_tax, sell_tax: t.sell_tax, is_open_source: t.is_open_source, is_proxy: t.is_proxy, owner_address: t.owner_address };
      if (bad.score === 0 && !honeypot && score === 0) { flags.push("CLEAN"); reasons.push({ code: "CLEAN", severity: 0, detail: "No major token-risk flags found", source: "uxus" }); }
    }
    if (!t && bad.score === 0) {
      degraded = true;
      flags.push("TOKEN_CHECK_UNAVAILABLE");
      reasons.push({ code: "TOKEN_CHECK_UNAVAILABLE", severity: 3, detail: "Token-security provider (GoPlus) did not return data — token-risk signals were NOT checked. Absence of flags is not a clean result.", source: "uxus" });
    }
  } else {
    const ws = await getWalletSignals(address, chain as "ethereum" | "base" | "arc");
    signals = { ...ws };
    const applied = applyWalletSignals({ score, flags, reasons }, ws);
    score = applied.score; flags = applied.flags; reasons = applied.reasons;
    degraded = applied.degraded;
  }

  score = Math.min(100, Math.max(0, score));
  let level = levelFromScore(score);
  let verdict = verdictFromLevel(level);
  // Degraded with no list hit: the verdict was not fully assessed. Floor it at
  // CAUTION — never report PROCEED for an address we could not vet.
  if (degraded && bad.score === 0 && verdict === "PROCEED") {
    level = "medium";
    verdict = "CAUTION";
  }
  return {
    address, chain, type,
    risk_score: score,
    risk_level: level,
    verdict,
    flags: [...new Set(flags)],
    reasons,
    signals,
    sources: [...sources],
    degraded,
    disclaimer: RISK_DISCLAIMER,
    checked_at: new Date().toISOString(),
    cache_ttl: 3600,
  };
}
