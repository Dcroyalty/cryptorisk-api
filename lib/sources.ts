// lib/sources.ts — live lookups against free APIs (called at request time).
// These run on Vercel (open internet). Each is wrapped so a failure degrades
// EXPLICITLY (signals_ok:false) rather than silently reading as "no history".

const EVM = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (a: string) => EVM.test(a);

export interface WalletSignals {
  wallet_age_days: number | null;
  tx_count: number | null;
  first_seen: string | null;
  last_seen: string | null;
  is_contract: boolean;
  // false = the block-explorer history lookup FAILED (rate-limited / down / bad
  // response). null/zero fields are then UNKNOWN, not "this wallet has no history".
  // Same contract as live-risk's rpc_ok.
  signals_ok: boolean;
}

const FAILED: WalletSignals = {
  wallet_age_days: null,
  tx_count: null,
  first_seen: null,
  last_seen: null,
  is_contract: false,
  signals_ok: false,
};

// --- Wallet behavior via Etherscan V2 (ETH) or Blockscout (Base). ---
// Etherscan free key covers Ethereum mainnet. For Base we use Blockscout (free, no key).
export async function getWalletSignals(
  address: string,
  chain: "ethereum" | "base",
): Promise<WalletSignals> {
  try {
    return chain === "base" ? await baseSignals(address) : await ethSignals(address);
  } catch {
    return { ...FAILED };
  }
}

async function ethSignals(address: string): Promise<WalletSignals> {
  const key = process.env.ETHERSCAN_API_KEY || "";
  const base = "https://api.etherscan.io/v2/api";
  const txUrl = `${base}?chainid=1&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=asc${key ? `&apikey=${key}` : ""}`;
  const r = await fetch(txUrl);
  if (!r.ok) return { ...FAILED };
  return signalsFromExplorer(await r.json());
}

async function baseSignals(address: string): Promise<WalletSignals> {
  // Blockscout Base (Etherscan-compatible), free
  const url = `https://base.blockscout.com/api?module=account&action=txlist&address=${address}&sort=asc`;
  const r = await fetch(url);
  if (!r.ok) return { ...FAILED };
  return signalsFromExplorer(await r.json());
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
    return { wallet_age_days: null, tx_count: 0, first_seen: null, last_seen: null, is_contract: false, signals_ok: true };
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
    is_contract: false,
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
