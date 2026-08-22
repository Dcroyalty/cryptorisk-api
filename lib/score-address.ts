import { sql } from "@/lib/db";
import { getWalletSignals, getTokenRisk } from "@/lib/sources";
import {
  scoreFromBadHits, applyWalletSignals, levelFromScore, verdictFromLevel,
  type RiskResult, type Reason,
} from "@/lib/scoring";

const CHAIN_IDS: Record<string, number> = { ethereum: 1, base: 8453 };
export const SUPPORTED_CHAINS = Object.keys(CHAIN_IDS);
export function chainId(chain: string) { return CHAIN_IDS[chain]; }

export async function scoreAddress(address: string, chain: string, type: "wallet" | "token"): Promise<RiskResult> {
  const hits = await sql`SELECT source, category FROM bad_addresses WHERE address = ${address}` as { source: string; category: string }[];
  const bad = scoreFromBadHits(hits);

  let score = bad.score;
  let flags = [...bad.flags];
  let reasons: Reason[] = [...bad.reasons];
  const sources = new Set<string>(["ofac", "scamsniffer", "mew", ...bad.sources]);
  let signals: Record<string, unknown> = {};

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
      if (bad.score === 0 && !honeypot && score === 0) { flags.push("CLEAN"); reasons.push({ code: "CLEAN", severity: 0, detail: "No major token-risk flags found", source: "cryptorisk" }); }
    }
  } else {
    const ws = await getWalletSignals(address, chain as "ethereum" | "base");
    signals = ws;
    const applied = applyWalletSignals({ score, flags, reasons }, ws);
    score = applied.score; flags = applied.flags; reasons = applied.reasons;
  }

  score = Math.min(100, Math.max(0, score));
  const level = levelFromScore(score);
  return {
    address, chain, type,
    risk_score: score,
    risk_level: level,
    verdict: verdictFromLevel(level),
    flags: [...new Set(flags)],
    reasons,
    signals,
    sources: [...sources],
    checked_at: new Date().toISOString(),
    cache_ttl: 3600,
  };
}
