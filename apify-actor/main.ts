// main.ts — Wallet & Address Sanctions + Risk Screener (Apify actor)
//
// Orchestration only. Every actual signal comes from lib/, byte-identical
// copies of uxus.finance's production scoring code (score-address.ts,
// scoring.ts, sources.ts, live-risk.ts, arc.ts, disclaimer.ts, db.ts) — see
// each file's header. This file does not reimplement any scoring logic; it
// validates input, calls the two existing engines per address, merges their
// output into one record, and charges per address screened.

import { Actor, log } from "apify";
import { scoreAddress } from "@/lib/score-address";
import { analyzeLiveRisk, type Chain } from "@/lib/live-risk";
import { isEvmAddress } from "@/lib/sources";
import { isArcMainnetLive } from "@/lib/arc";
import { RISK_DISCLAIMER } from "@/lib/disclaimer";

const MAX_ADDRESSES = 1000;
const CHARGE_EVENT = "address-screened";

interface Input {
  addresses?: string[];
  chain?: "ethereum" | "base" | "arc";
}

function sanctionsSourceOf(reasons: { code: string; source: string }[]): string | null {
  const hit = reasons.find((r) => r.code === "SANCTIONED");
  return hit ? hit.source : null;
}

async function main(): Promise<void> {
  await Actor.init();

  const input = (await Actor.getInput<Input>()) ?? {};
  const chain = (input.chain ?? "ethereum") as Chain;
  const rawAddresses = Array.isArray(input.addresses) ? input.addresses : [];

  if (!["ethereum", "base", "arc"].includes(chain)) {
    await Actor.fail(`chain must be "ethereum", "base", or "arc" — got "${String(input.chain)}".`);
    return;
  }

  if (rawAddresses.length === 0) {
    await Actor.fail('Input must include a non-empty "addresses" array.');
    return;
  }

  if (rawAddresses.length > MAX_ADDRESSES) {
    await Actor.fail(
      `Got ${rawAddresses.length} addresses — this actor caps at ${MAX_ADDRESSES} per run. Split into multiple runs.`,
    );
    return;
  }

  // Same chain-network honesty as the live site: Arc mainnet isn't configured
  // in every deployment. If it isn't here, say so on every record for this
  // run rather than silently scoring against Arc testnet as if it were mainnet.
  const arcLive = chain === "arc" ? isArcMainnetLive() : null;

  let processed = 0;

  for (const raw of rawAddresses) {
    const trimmed = String(raw ?? "").trim();

    if (!isEvmAddress(trimmed)) {
      await Actor.pushData({
        address: raw,
        chain,
        valid: false,
        error: "invalid_address",
        message: "Not a valid 0x-prefixed, 40-hex-char EVM address — not screened, not charged.",
        checked_at: new Date().toISOString(),
      });
      continue; // no charge — no work was done
    }

    // bad_addresses is stored lowercase and scoreAddress() does a case-sensitive
    // equality match (it relies on the CALLER to normalize, same as every
    // production route — see app/api/risk/route.ts's raw.toLowerCase()). Skipping
    // this turns a checksummed OFAC address (the normal display format) into a
    // silent false "CLEAN". Caught by testing against a real address from our
    // own bad_addresses table, not assumed.
    const address = trimmed.toLowerCase();

    const [sanctions, live] = await Promise.all([
      scoreAddress(address, chain, "wallet"),
      analyzeLiveRisk(address, chain),
    ]);

    const degraded = sanctions.degraded || !live.rpc_ok;

    await Actor.pushData({
      address,
      chain,
      valid: true,
      // Never silently OK when a source came back degraded — this mirrors the
      // live API's rule verbatim: floor at CAUTION, never assert clean.
      degraded,
      // --- OFAC SDN + scam/phishing registries + wallet age/tx history ---
      sanctions_verdict: sanctions.verdict,           // PROCEED | CAUTION | BLOCK
      sanctions_risk_score: sanctions.risk_score,      // 0-100
      sanctions_flags: sanctions.flags,
      sanctions_reasons: sanctions.reasons,
      sanctions_source: sanctionsSourceOf(sanctions.reasons), // real list name, or null — never "OFAC" for a non-OFAC hit
      wallet_signals: sanctions.signals,               // wallet_age_days, tx_count, signals_ok, ...
      lists_consulted: sanctions.sources,
      // --- live on-chain contract control reads ---
      is_contract: live.is_contract,
      mutable_verdict: live.verdict,                   // SAFE_TO_HOLD | MONITOR | EXIT_RISK | DO_NOT_HOLD
      mutable_risk_score: live.mutable_risk_score,
      can_turn_hostile: live.can_turn_hostile,
      time_to_rug: live.time_to_rug,
      owner_powers: live.powers,                       // e.g. OWNER_CAN_REPLACE_ALL_CONTRACT_LOGIC, or an *_UNKNOWN code when a read didn't land
      controls: live.controls,
      rpc_ok: live.rpc_ok,
      ...(chain === "arc" ? { arc_network: arcLive ? "mainnet" : "testnet" } : {}),
      disclaimer: RISK_DISCLAIMER,
      checked_at: new Date().toISOString(),
    });

    await Actor.charge({ eventName: CHARGE_EVENT, count: 1 });
    processed++;
  }

  log.info(`Screened ${processed}/${rawAddresses.length} address(es) on ${chain}.`);

  await Actor.exit();
}

main().catch(async (err) => {
  log.exception(err as Error, "Unhandled error in main()");
  await Actor.fail(err instanceof Error ? err.message : String(err));
});
