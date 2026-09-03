// lib/callerid.ts — "should this wallet be answered." Pure recommendation logic.
// Composes entity attribution + risk verdict + a forward-verified name into
// ANSWER | SCREEN | BLOCK, with the reasoning. No I/O — testable in isolation.
//
// Precedence: BLOCK > ANSWER > SCREEN. SCREEN is the default for unknown
// addresses — that is not a failure. When an input is unavailable the logic
// degrades toward SCREEN, never toward ANSWER.

import { lookupEntity } from "@/lib/entity";
import { scoreAddress } from "@/lib/score-address";
import { evmAccountState } from "@/lib/evm-account";
import { primaryName } from "@/lib/resolve";

const BLOCK_CATEGORIES = new Set(["sanctioned", "drainer", "phishing", "scam", "mixer"]);
// categories that can plausibly originate a message (run a notification service)
const ANSWER_CATEGORIES = new Set(["exchange", "dex_router", "protocol"]);
// known, not hostile, but a contract that cannot originate a message — a caller
// resolving to one of these is an impersonation signal (flag, don't punish)
const NON_ORIGINATING_CATEGORIES = new Set(["bridge", "token_contract"]);

export interface CallerIdInput {
  entity: { is_known: boolean; label: string | null; category: string } | null;
  risk: { score: number; level: string; verdict: "PROCEED" | "CAUTION" | "BLOCK" } | null;
  name: string | null;
}

export interface CallerIdResult {
  recommendation: "ANSWER" | "SCREEN" | "BLOCK";
  confidence: "high" | "low";
  reasons: string[];
}

export function recommend(input: CallerIdInput): CallerIdResult {
  const { entity, risk, name } = input;
  // high only when BOTH decision-critical inputs resolved
  const confidence: "high" | "low" = entity !== null && risk !== null ? "high" : "low";

  // ---- BLOCK ----
  const block: string[] = [];
  if (entity?.category && BLOCK_CATEGORIES.has(entity.category)) {
    block.push(`entity category: ${entity.category}`);
  }
  if (risk?.verdict === "BLOCK") {
    block.push("risk verdict: BLOCK");
  }
  if (block.length) return { recommendation: "BLOCK", confidence, reasons: block };

  // ---- ANSWER (only if no BLOCK trigger fired) ----
  const entityIdentity =
    entity?.is_known === true && !!entity.category && ANSWER_CATEGORIES.has(entity.category);
  const answer: string[] = [];
  if (entityIdentity && risk?.verdict === "PROCEED") {
    answer.push(`known entity: ${entity!.label ?? entity!.category} (${entity!.category})`);
  }
  if (name != null && risk?.verdict === "PROCEED") {
    answer.push(`verified name: ${name}`);
  }
  if (answer.length) {
    answer.push("risk verdict: PROCEED");
    return { recommendation: "ANSWER", confidence, reasons: answer };
  }

  // ---- SCREEN (default) — name the missing positive signal ----
  const reasons: string[] = [];
  if (entityIdentity) {
    // identity signal present but it didn't clear the ANSWER bar (risk not PROCEED)
    reasons.push(`known entity: ${entity!.label ?? entity!.category} (${entity!.category})`);
  } else if (entity === null) {
    reasons.push("entity lookup unavailable");
  } else if (!entity.is_known) {
    reasons.push("unknown entity");
  } else if (NON_ORIGINATING_CATEGORIES.has(entity.category)) {
    reasons.push(
      `caller claims to be a contract that cannot originate messages (${entity.label ?? entity.category})`,
    );
  } else {
    reasons.push(`known entity, non-originator category: ${entity.category}`);
  }

  reasons.push(name != null ? `verified name: ${name}` : "no verified name");

  if (risk === null) reasons.push("risk scoring unavailable");
  else reasons.push(`risk verdict: ${risk.verdict}`);

  return { recommendation: "SCREEN", confidence, reasons };
}

// ---- Composition: the I/O half. Shared by /api/callerid and /api/shield/check. ----

export interface ComposedCallerId {
  entity: { is_known: boolean; label: string | null; category: string } | null;
  risk: { score: number; level: string; verdict: "PROCEED" | "CAUTION" | "BLOCK" } | null;
  name: string | null;
  exists: boolean | null;
  result: CallerIdResult;
}

// Gathers every input in parallel, tolerating per-source failure (allSettled),
// then runs recommend(). A failed lookup becomes null and the reasoning says so —
// it never silently reads as "clean".
export async function composeCallerId(
  address: string,
  chain: "base" | "ethereum",
): Promise<ComposedCallerId> {
  const addr = address.toLowerCase();
  const [entR, riskR, acctR, nameR] = await Promise.allSettled([
    lookupEntity(addr, chain),
    scoreAddress(addr, chain, "wallet"),
    evmAccountState(chain, addr),
    primaryName(addr),
  ]);

  const e = entR.status === "fulfilled" ? entR.value : null;
  const s = riskR.status === "fulfilled" ? riskR.value : null;
  const a = acctR.status === "fulfilled" ? acctR.value : null;
  const name = nameR.status === "fulfilled" && nameR.value ? nameR.value.name : null;

  const entity = e ? { is_known: e.is_known, label: e.label, category: e.category } : null;
  const risk = s ? { score: s.risk_score, level: s.risk_level, verdict: s.verdict } : null;
  const exists = a
    ? a.has_code || a.nonce > 0 || a.balance_wei > BigInt(0)
      ? true
      : a.fully_checked
        ? false
        : null
    : null;

  return { entity, risk, name, exists, result: recommend({ entity, risk, name }) };
}
