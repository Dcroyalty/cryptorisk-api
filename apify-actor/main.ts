// main.ts — Wallet & Address Sanctions + Risk Screener (Apify actor)
//
// Orchestration only. Every actual signal comes from lib/, byte-identical
// copies of uxus.finance's production scoring code (score-address.ts,
// scoring.ts, sources.ts, live-risk.ts, arc.ts, disclaimer.ts, db.ts) — see
// each file's header. This file does not reimplement any scoring logic; it
// validates input, calls the two existing engines per address, merges their
// output into one record, and charges per address screened.
//
// NEVER EXIT FAILED ON A HANDLED CONDITION. Apify's automated QA runs the actor
// with the INPUT_SCHEMA prefill values and marks it "Under maintenance" on any
// run that is not SUCCEEDED within 5 minutes. So every path below that is not a
// genuine crash — bad/empty/oversized input, a missing DATABASE_URL, a Neon
// failure, an empty lists table, an RPC/explorer hang, a charge limit — pushes a
// dataset item that says what happened and exits SUCCEEDED (exit code 0). Only an
// unexpected exception reaches Actor.fail(). None of these records is a verdict:
// an address we could not screen is reported as NOT screened, never as clean.

import { Actor, log } from "apify";
import { analyzeLiveRisk, type Chain, type LiveRisk } from "@/lib/live-risk";
import { isEvmAddress } from "@/lib/sources";
import { isArcMainnetLive } from "@/lib/arc";
import { RISK_DISCLAIMER } from "@/lib/disclaimer";
import type { RiskResult } from "@/lib/scoring";

// NOTE: "@/lib/db" throws at import time when DATABASE_URL is unset, and
// "@/lib/score-address" imports it. Both are therefore loaded with a dynamic
// import() inside main(), where the failure becomes a record instead of a crash on
// module load — without touching the byte-identical lib/ copies.

const MAX_ADDRESSES = 1000;
const CHARGE_EVENT = "address-screened";
// lib/sources.ts fetches the block explorer with no timeout, so one hung explorer
// could stall a run past Apify's 5-minute QA limit. Bound each address here.
const ADDRESS_TIMEOUT_MS = 45_000;
const DB_TIMEOUT_MS = 30_000;
// Stop instead of emitting an error record per remaining address when every
// address is failing the same way (database down, provider outage).
const MAX_CONSECUTIVE_FAILURES = 3;

interface Input {
  addresses?: string[] | string;
  chain?: string;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what} did not answer within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const messageOf = (e: unknown) => String((e as Error)?.message ?? e ?? "unknown error").slice(0, 500);

function sanctionsSourceOf(reasons: { code: string; source: string }[]): string | null {
  const hit = reasons.find((r) => r.code === "SANCTIONED");
  return hit ? hit.source : null;
}

// lib/live-risk's unknownResult() fills the contract-read fields with defaults
// (is_contract:false, can_turn_hostile:true, ownership_renounced:false, score 50)
// when the chain couldn't be read, or when only some of the reads landed. Those
// look like observations and are not. When rpc_ok is false every observed value is
// null — "we couldn't read this" — including is_contract even if eth_getCode landed
// before a later read failed: the block is all-or-nothing.
// Kept as-is: mutable_verdict (MONITOR is a floor, like CAUTION on the sanctions
// side, never a clean read) and owner_powers (the *_UNKNOWN code is the explicit
// "couldn't read" marker).
function contractReads(live: LiveRisk) {
  if (live.rpc_ok) {
    return {
      is_contract: live.is_contract,
      mutable_verdict: live.verdict,
      mutable_risk_score: live.mutable_risk_score,
      can_turn_hostile: live.can_turn_hostile,
      time_to_rug: live.time_to_rug,
      owner_powers: live.powers,
      controls: live.controls,
    };
  }
  return {
    is_contract: null,
    mutable_verdict: live.verdict,
    mutable_risk_score: null,
    can_turn_hostile: null,
    time_to_rug: null,
    owner_powers: live.powers,
    controls: {
      owner: null,
      ownership_renounced: null,
      is_upgradeable_proxy: null,
      proxy_admin: null,
      implementation: null,
      has_pause: null,
      is_paused: null,
      pending_owner: null,
    },
  };
}

async function main(): Promise<void> {
  await Actor.init();

  let pushed = 0;
  let errors = 0;
  // Only set once validated: the dataset schema enumerates chain, so a bad value must never be echoed into a record.
  let recordChain: Chain | undefined;

  /** Push a record that explains what happened. `address` stays a string (dataset schema). */
  const notice = async (address: string, error: string, message: string, extra: { hint?: string; valid?: boolean } = {}) => {
    await Actor.pushData({
      address,
      ...(recordChain ? { chain: recordChain } : {}),
      ...extra,
      error,
      message,
      checked_at: new Date().toISOString(),
    });
    pushed++;
    errors++;
  };

  /** Every path ends here: guarantee at least one dataset item, then exit SUCCEEDED. */
  const finish = async (statusMessage: string): Promise<void> => {
    if (pushed === 0) {
      await Actor.pushData({ address: "", error: "no_output", message: "The run completed without producing any results.", checked_at: new Date().toISOString() });
      pushed++;
    }
    log.info(statusMessage);
    await Actor.exit({ statusMessage, exitCode: 0 });
  };

  const input = (await Actor.getInput<Input>()) ?? {};
  const chainInput = typeof input.chain === "string" && input.chain.trim() ? input.chain.trim().toLowerCase() : "ethereum";
  const rawAddresses = Array.isArray(input.addresses) ? input.addresses : typeof input.addresses === "string" ? [input.addresses] : [];

  if (!["ethereum", "base", "arc"].includes(chainInput)) {
    await notice("", "invalid_chain", `chain must be "ethereum", "base", or "arc" — got "${String(input.chain).slice(0, 60)}". Nothing was screened.`, {
      hint: 'Use one of: "ethereum", "base", "arc".',
    });
    return finish("Nothing screened: invalid chain (see the dataset item).");
  }
  const chain = chainInput as Chain;
  recordChain = chain;

  if (rawAddresses.length === 0) {
    await notice("", "no_addresses", 'Input must include a non-empty "addresses" array, so nothing was screened.', {
      hint: 'Example input: { "addresses": ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"], "chain": "ethereum" }',
    });
    return finish('Nothing screened: no "addresses" in the input (see the dataset item).');
  }

  let addresses = rawAddresses;
  if (addresses.length > MAX_ADDRESSES) {
    const skipped = addresses.length - MAX_ADDRESSES;
    addresses = addresses.slice(0, MAX_ADDRESSES);
    await notice("", "too_many_addresses", `Got ${MAX_ADDRESSES + skipped} addresses; this Actor caps at ${MAX_ADDRESSES} per run. The first ${MAX_ADDRESSES} were screened; ${skipped} were not.`, {
      hint: "Split the remaining addresses into another run.",
    });
  }

  // Without the database there are no sanctions/scam lists, and screening without them
  // would return every address as clean — the silent false-clean this actor exists to
  // avoid. So: say so and screen nothing.
  if (!process.env.DATABASE_URL?.trim()) {
    await notice("", "missing_database_url", "DATABASE_URL is not set for this Actor, so the sanctions/scam lists could not be read and nothing was screened.", {
      hint: "Add DATABASE_URL under this Actor's Settings -> Environment variables in the Apify Console, then run again.",
    });
    return finish("Nothing screened: DATABASE_URL is not configured (see the dataset item).");
  }

  let scoreAddress: typeof import("@/lib/score-address").scoreAddress;
  let listsConsulted: string[];
  try {
    const { sql } = await import("@/lib/db");
    ({ scoreAddress } = await import("@/lib/score-address"));
    // Every list scoreAddress() checks an address against: the distinct sources in
    // bad_addresses. Read from the table rather than hardcoded so it stays true when a
    // list is added or dropped. scoreAddress()'s own `sources` is only the lists that
    // MATCHED, which reads as "nothing was checked" on a clean address — that is
    // lists_matched here, not lists_consulted.
    const rows = (await withTimeout(Promise.resolve(sql`SELECT DISTINCT source FROM bad_addresses ORDER BY source`), DB_TIMEOUT_MS, "The database")) as { source: string }[];
    listsConsulted = rows.map((r) => r.source);
  } catch (e) {
    await notice("", "database_unavailable", `The sanctions/scam list database could not be read, so nothing was screened: ${messageOf(e)}`, {
      hint: "Check DATABASE_URL under this Actor's Settings -> Environment variables and that the Neon database is reachable, then run again.",
    });
    return finish("Nothing screened: the list database is unavailable (see the dataset item).");
  }

  if (listsConsulted.length === 0) {
    await notice("", "no_lists_loaded", "bad_addresses has no lists loaded, so nothing was screened — refusing to report addresses as clean against an empty sanctions/scam dataset.", {
      hint: "The list refresh on uxus.finance must run before this Actor can screen.",
    });
    return finish("Nothing screened: no sanctions/scam lists are loaded (see the dataset item).");
  }

  // Same chain-network honesty as the live site: Arc mainnet isn't configured
  // in every deployment. If it isn't here, say so on every record for this
  // run rather than silently scoring against Arc testnet as if it were mainnet.
  const arcLive = chain === "arc" ? isArcMainnetLive() : null;

  let processed = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < addresses.length; i++) {
    const trimmed = String(addresses[i] ?? "").trim();

    if (!isEvmAddress(trimmed)) {
      await Actor.pushData({
        address: trimmed,
        chain,
        valid: false,
        error: "invalid_address",
        message: "Not a valid 0x-prefixed, 40-hex-char EVM address — not screened, not charged.",
        checked_at: new Date().toISOString(),
      });
      pushed++;
      errors++;
      continue; // no charge — no work was done
    }

    // bad_addresses is stored lowercase and scoreAddress() does a case-sensitive
    // equality match (it relies on the CALLER to normalize, same as every
    // production route — see app/api/risk/route.ts's raw.toLowerCase()). Skipping
    // this turns a checksummed OFAC address (the normal display format) into a
    // silent false "CLEAN". Caught by testing against a real address from our
    // own bad_addresses table, not assumed.
    const address = trimmed.toLowerCase();

    let sanctions: RiskResult;
    let live: LiveRisk;
    try {
      [sanctions, live] = await withTimeout(Promise.all([scoreAddress(address, chain, "wallet"), analyzeLiveRisk(address, chain)]), ADDRESS_TIMEOUT_MS, "Screening");
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      const timedOut = e instanceof TimeoutError;
      await notice(address, timedOut ? "screening_timeout" : "screening_failed", `${timedOut ? messageOf(e) : `Screening failed: ${messageOf(e)}`}. This address was NOT screened — do not read this record as clean.`, {
        valid: true,
        hint: "Not charged. Retry this address in a new run; a repeated failure usually means the list database or a data provider is down.",
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        const left = addresses.length - i - 1;
        if (left > 0) {
          await notice("", "screening_aborted", `${MAX_CONSECUTIVE_FAILURES} addresses in a row failed, so the ${left} remaining address(es) were not attempted.`, {
            hint: "Retry those addresses in a new run.",
          });
        }
        break;
      }
      continue; // no charge — no verdict was produced
    }

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
      lists_consulted: listsConsulted,                 // every list checked, hit or not
      lists_matched: sanctions.sources,                // only the lists that matched this address
      // --- live on-chain contract control reads (all null when rpc_ok is false) ---
      ...contractReads(live),
      rpc_ok: live.rpc_ok,
      ...(chain === "arc" ? { arc_network: arcLive ? "mainnet" : "testnet" } : {}),
      disclaimer: RISK_DISCLAIMER,
      checked_at: new Date().toISOString(),
    });
    pushed++;
    processed++;

    // The verdict is already delivered; a charging problem must never fail the run.
    try {
      const charge = await Actor.charge({ eventName: CHARGE_EVENT, count: 1 });
      if (charge?.eventChargeLimitReached) {
        const left = addresses.length - i - 1;
        if (left > 0) {
          await notice("", "charge_limit_reached", `The maximum charge for this run was reached, so the ${left} remaining address(es) were not screened.`, {
            hint: "Raise the run's maximum cost and screen the remaining addresses again.",
          });
        }
        break;
      }
    } catch (e) {
      log.warning(`Actor.charge failed (result kept, run continues): ${messageOf(e)}`);
    }
  }

  await finish(`Screened ${processed}/${addresses.length} address${addresses.length === 1 ? "" : "es"} on ${chain}${errors ? `; ${errors} error record${errors === 1 ? "" : "s"} in the dataset` : ""}.`);
}

// A genuine crash (a bug, out of memory, the dataset itself unwritable) is the ONLY thing that may fail the run.
main().catch(async (err) => {
  log.exception(err as Error, "Unhandled error in main()");
  await Actor.fail(err instanceof Error ? err.message : String(err));
});
