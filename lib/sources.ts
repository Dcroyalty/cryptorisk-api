// lib/sources.ts — live lookups against free APIs (called at request time).
// These run on Vercel (open internet). Each is wrapped so a failure degrades
// EXPLICITLY (signals_ok:false) rather than silently reading as "no history".

import { keccak_256 } from "@noble/hashes/sha3";
import { arcExplorerUrl } from "./arc";

const EVM = /^0x[0-9a-fA-F]{40}$/;

/** The EIP-55 checksummed spelling of a 40-hex address body: a hex letter is upper-case when the matching nibble of keccak256(lower-case body) is >= 8. */
function eip55Body(body: string): string {
  const lower = body.toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "";
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/**
 * A well-formed EVM address. All-lowercase or all-uppercase hex carries no checksum, so it is accepted as written.
 * A MIXED-case address is an EIP-55 checksummed address and its checksum must verify: a typo in one is rejected here,
 * before any lookup, instead of being screened as if it were a different (usually clean) address.
 */
export function isEvmAddress(a: string): boolean {
  if (typeof a !== "string" || !EVM.test(a)) return false;
  const body = a.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return eip55Body(body) === body;
}

export interface WalletSignals {
  wallet_age_days: number | null;
  tx_count: number | null;
  first_seen: string | null;
  last_seen: string | null;
  // false = the block-explorer history lookup FAILED (rate-limited / down / bad
  // response). null/zero fields are then UNKNOWN, not "this wallet has no history".
  // Same contract as live-risk's rpc_ok.
  signals_ok: boolean;
  // Present only when the explorer was unavailable and the history came from
  // the chain itself (see chainSignals): tx_count is then OUTGOING transactions
  // only (the account nonce) and the two dates are accurate to about a day.
  history_source?: "chain";
}

const FAILED: WalletSignals = {
  wallet_age_days: null,
  tx_count: null,
  first_seen: null,
  last_seen: null,
  signals_ok: false,
};

// --- Wallet behavior via Etherscan V2 (ETH) or Blockscout (Base, Arc). ---
// Etherscan free key covers Ethereum mainnet. Base and Arc use Blockscout (free, no key).
export async function getWalletSignals(
  address: string,
  chain: "ethereum" | "base" | "arc",
): Promise<WalletSignals> {
  try {
    if (chain === "base") return await baseSignals(address);
    if (chain === "arc") return await arcSignals(address);
    return await ethSignals(address);
  } catch {
    return { ...FAILED };
  }
}

// Keyless Blockscout allows 10 requests per window per IP and 429s past that
// (x-ratelimit-reset is ms until the window reopens — up to minutes once
// tripped). Under a burst that turned over half of lookups into
// degraded/CAUTION. Retry a 429 only when the window reopens within ~2.5s;
// otherwise fail fast to the degraded verdict instead of adding latency.
// Second path: the Blockscout PRO API with a key (see proFallbackUrl) takes over
// when the per-IP instance limit is hit.
const EXPLORER_429_RETRIES = 2;
const MAX_429_WAIT_MS = 2500;
// Heavy wallets (thousands of txs) can take 60s+ keyless; cap it so one lookup
// can't hold a function open indefinitely. Timeout -> degraded, never PROCEED.
const EXPLORER_TIMEOUT_MS = 25_000;

// Two kinds of Blockscout key exist, told apart by prefix:
//  • PRO API key ("proapi_...", from dev.blockscout.com): valid ONLY on
//    api.blockscout.com/v2/api?chain_id=... (all chains, free plan 5 req/s,
//    100K credits/day). An explorer instance silently IGNORES it (verified
//    2026-09-30: base.blockscout.com still reports the keyless 10/window limit).
//  • Instance key (base.blockscout.com -> My Account -> API keys): appended to
//    that instance's own /api calls. BLOCKSCOUT_ETH_API_KEY is the eth.blockscout.com one.
const isProKey = (k: string | undefined): k is string => !!k && k.startsWith("proapi_");

function withBlockscoutKey(url: string): string {
  const key = url.startsWith("https://base.blockscout.com/")
    ? process.env.BLOCKSCOUT_API_KEY
    : url.startsWith("https://eth.blockscout.com/")
      ? process.env.BLOCKSCOUT_ETH_API_KEY
      : undefined;
  return key && !isProKey(key) ? `${url}&apikey=${encodeURIComponent(key)}` : url;
}

// The PRO API is the fallback when the keyless per-IP instance limit is hit
// (every Vercel egress IP gets its own instance allowance, so trying the
// instance first spreads a burst; the PRO key's 5 req/s is shared).
function proFallbackUrl(chainId: number, address: string): string | null {
  const key = [process.env.BLOCKSCOUT_API_KEY, process.env.BLOCKSCOUT_ETH_API_KEY].find(isProKey);
  if (!key) return null;
  return `https://api.blockscout.com/v2/api?chain_id=${chainId}&module=account&action=txlist&address=${address}&sort=asc&page=1&offset=10000&apikey=${encodeURIComponent(key)}`;
}

// Only a rate-limit / lockout falls back — not a timeout or other failure (a
// heavy wallet that timed out on the instance would just time out again).
async function withProFallback(first: Fetched, chainId: number, address: string): Promise<WalletSignals> {
  if (first.signals.signals_ok || !first.limited) return first.signals;
  const pro = proFallbackUrl(chainId, address);
  return pro ? (await fetchExplorer(pro)).signals : first.signals;
}

// Circuit breaker: once an explorer says our IP is locked out for longer than
// we'd wait, stop calling it until the window reopens (per function instance).
// Hammering a locked window only extends it for every other request.
const explorerLockedUntil = new Map<string, number>();

type Fetched = { signals: WalletSignals; limited: boolean };

async function fetchSignals(rawUrl: string): Promise<WalletSignals> {
  return (await fetchExplorer(rawUrl)).signals;
}

async function fetchExplorer(rawUrl: string): Promise<Fetched> {
  const url = withBlockscoutKey(rawUrl);
  const host = new URL(url).host;
  if ((explorerLockedUntil.get(host) ?? 0) > Date.now()) return { signals: { ...FAILED }, limited: true };
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "uxus-risk" }, signal: AbortSignal.timeout(EXPLORER_TIMEOUT_MS) });
      if (r.status === 429 && attempt < EXPLORER_429_RETRIES) {
        const reset = Number(r.headers.get("x-ratelimit-reset"));
        const wait = Number.isFinite(reset) && reset > 0 ? reset : 1000;
        if (wait <= MAX_429_WAIT_MS) {
          await new Promise((res) => setTimeout(res, wait + Math.random() * 400));
          continue;
        }
      }
      if (r.status === 429) {
        const reset = Number(r.headers.get("x-ratelimit-reset"));
        // Cap at 5 min so a bogus header can't disable the explorer for long.
        explorerLockedUntil.set(host, Date.now() + Math.min(Number.isFinite(reset) && reset > 0 ? reset : 10_000, 300_000));
        return { signals: { ...FAILED }, limited: true };
      }
      // A 403 is the explorer's Cloudflare bot challenge (base.blockscout.com
      // answered every call that way on 2026-10-13). Same handling as a lockout:
      // stop calling it for 5 min and let the next source answer.
      if (r.status === 403) {
        explorerLockedUntil.set(host, Date.now() + 300_000);
        return { signals: { ...FAILED }, limited: true };
      }
      if (!r.ok) return { signals: { ...FAILED }, limited: false };
      return { signals: signalsFromExplorer(await r.json()), limited: false };
    } catch {
      return { signals: { ...FAILED }, limited: false };
    }
  }
}

async function ethSignals(address: string): Promise<WalletSignals> {
  const key = process.env.ETHERSCAN_API_KEY || "";
  // Etherscan V2 now REQUIRES a key. Try it when we have one, then fall back to
  // Blockscout's Ethereum instance (Etherscan-compatible, keyless).
  if (key) {
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${key}`;
    const s = await fetchSignals(url);
    if (s.signals_ok) return s;
  }
  const s = await fetchExplorer(
    `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=10000`,
  );
  return withProFallback(s, 1, address);
}

async function baseSignals(address: string): Promise<WalletSignals> {
  // Blockscout Base instance (Etherscan-compatible, keyless), then the PRO API,
  // then the chain itself — so a blocked or slow explorer no longer means a
  // degraded verdict.
  const s = await fetchExplorer(
    `https://base.blockscout.com/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=10000`,
  );
  const fromExplorer = await withProFallback(s, 8453, address);
  if (fromExplorer.signals_ok) return fromExplorer;
  return chainSignals(address).catch(() => fromExplorer);
}

// --- Base wallet history without an explorer ---
// The account nonce is the number of transactions the address has sent, and an
// archive node answers it for any past block. Search for the block where the
// nonce first reached 1 (first activity) and where it reached today's value
// (last activity). Scoring only needs days, so the search stops within a day.
// Nonce 0 = never sent a transaction: a definitive "no outgoing history".
const BASE_ARCHIVE_RPCS = ["https://mainnet.base.org", "https://base.gateway.tenderly.co", "https://base.drpc.org"];
const CHAIN_RPC_TIMEOUT_MS = 6000;
const CHAIN_PROBES = 3;
const CHAIN_SEARCH_STOP_BLOCKS = 43_200; // one day of 2 s blocks
let archiveRpcStart = 0;

async function archiveRpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  // Two passes over the pool: public nodes 429 in bursts and recover within a moment.
  for (let i = 0; i < BASE_ARCHIVE_RPCS.length * 2; i++) {
    if (i === BASE_ARCHIVE_RPCS.length) await new Promise((res) => setTimeout(res, 300));
    const url = BASE_ARCHIVE_RPCS[(archiveRpcStart + i) % BASE_ARCHIVE_RPCS.length];
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(CHAIN_RPC_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`${url} ${r.status}`);
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.error || j.result == null) throw new Error(`${url} rpc error`);
      return j.result;
    } catch (e) {
      last = e;
      archiveRpcStart = (archiveRpcStart + 1) % BASE_ARCHIVE_RPCS.length;
    }
  }
  throw last;
}

const hexBlock = (n: number) => "0x" + n.toString(16);

// Smallest probed block (within CHAIN_SEARCH_STOP_BLOCKS) at which the nonce is >= target.
async function firstBlockWithNonce(address: string, target: number, latest: number): Promise<number> {
  let lo = 0;
  let hi = latest;
  while (hi - lo > CHAIN_SEARCH_STOP_BLOCKS) {
    const step = (hi - lo) / (CHAIN_PROBES + 1);
    const points = Array.from({ length: CHAIN_PROBES }, (_, i) => Math.floor(lo + step * (i + 1)));
    const nonces = await Promise.all(points.map((b) => archiveRpc<string>("eth_getTransactionCount", [address, hexBlock(b)])));
    const k = nonces.findIndex((n) => parseInt(n, 16) >= target);
    if (k === -1) lo = points[CHAIN_PROBES - 1];
    else {
      hi = points[k];
      if (k > 0) lo = points[k - 1];
    }
  }
  return hi;
}

async function chainSignals(address: string): Promise<WalletSignals> {
  const [head, n] = await Promise.all([
    archiveRpc<string>("eth_blockNumber", []),
    archiveRpc<string>("eth_getTransactionCount", [address, "latest"]),
  ]);
  const latest = parseInt(head, 16);
  const nonce = parseInt(n, 16);
  if (!Number.isFinite(latest) || !Number.isFinite(nonce)) throw new Error("bad rpc answer");
  if (nonce === 0) {
    return { wallet_age_days: null, tx_count: 0, first_seen: null, last_seen: null, signals_ok: true, history_source: "chain" };
  }
  const [firstBlock, lastBlock] = await Promise.all([
    firstBlockWithNonce(address, 1, latest),
    nonce > 1 ? firstBlockWithNonce(address, nonce, latest) : Promise.resolve(null),
  ]);
  const [b1, b2] = await Promise.all(
    [firstBlock, lastBlock ?? firstBlock].map((b) => archiveRpc<{ timestamp: string }>("eth_getBlockByNumber", [hexBlock(b), false])),
  );
  const firstTs = parseInt(b1.timestamp, 16) * 1000;
  const lastTs = parseInt(b2.timestamp, 16) * 1000;
  if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) throw new Error("bad block timestamp");
  return {
    wallet_age_days: Math.floor((Date.now() - firstTs) / 86400000),
    tx_count: nonce,
    first_seen: new Date(firstTs).toISOString(),
    last_seen: new Date(lastTs).toISOString(),
    signals_ok: true,
    history_source: "chain",
  };
}

async function arcSignals(address: string): Promise<WalletSignals> {
  // Blockscout Arc (Etherscan-compatible), keyless. URL resolved from
  // ARC_EXPLORER_URL, defaulting to testnet — mainnet cutover is an env change.
  return fetchSignals(
    `${arcExplorerUrl()}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=10000`,
  );
}

// Etherscan/Blockscout return `result: [...]` on success (an empty array = a
// genuine "no transactions" answer), but `result: "<error string>"` (or a
// missing result, or status "0" + "rate limit" message) when the call failed.
// Only an array is a real answer — anything else is a failed read.
function signalsFromExplorer(j: unknown): WalletSignals {
  const body = j as { status?: string; message?: string; result?: unknown } | null;
  const result = body?.result;
  if (!Array.isArray(result)) {
    return { ...FAILED };
  }
  // Some explorers answer "no txs" as status "0" + message "No transactions
  // found" + result []. That IS a definitive answer, so an empty array is fine.
  return signalsFromTxList(result);
}

function signalsFromTxList(list: unknown[]): WalletSignals {
  if (list.length === 0) {
    return { wallet_age_days: null, tx_count: 0, first_seen: null, last_seen: null, signals_ok: true };
  }
  const first = list[0] as { timeStamp?: string };
  const last = list[list.length - 1] as { timeStamp?: string };
  const firstTs = first?.timeStamp ? Number(first.timeStamp) * 1000 : null;
  const lastTs = last?.timeStamp ? Number(last.timeStamp) * 1000 : null;
  const ageDays = firstTs ? Math.floor((Date.now() - firstTs) / 86400000) : null;
  return {
    wallet_age_days: ageDays,
    tx_count: list.length,
    first_seen: firstTs ? new Date(firstTs).toISOString() : null,
    last_seen: lastTs ? new Date(lastTs).toISOString() : null,
    signals_ok: true,
  };
}

// --- Token risk via GoPlus (free, 30/min) ---
export async function getTokenRisk(address: string, chainId: number) {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
    const j = await r.json();
    const key = Object.keys(j.result || {})[0];
    const d = j.result?.[key];
    if (!d) return null;
    return d as Record<string, string>;
  } catch { return null; }
}
