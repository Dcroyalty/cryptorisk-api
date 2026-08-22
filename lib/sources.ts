// lib/sources.ts — live lookups against free APIs (called at request time).
// These run on Vercel (open internet). Each is wrapped so a failure degrades
// gracefully rather than breaking the whole score.

const EVM = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (a: string) => EVM.test(a);

// --- Wallet behavior via Etherscan V2 (ETH) or Blockscout (Base). ---
// Etherscan free key covers Ethereum mainnet. For Base we use Blockscout (free, no key).
export async function getWalletSignals(address: string, chain: "ethereum" | "base") {
  try {
    if (chain === "base") return await baseSignals(address);
    return await ethSignals(address);
  } catch {
    return { wallet_age_days: null, tx_count: null, first_seen: null, last_seen: null, is_contract: false };
  }
}

async function ethSignals(address: string) {
  const key = process.env.ETHERSCAN_API_KEY || "";
  const base = "https://api.etherscan.io/v2/api";
  const txUrl = `${base}?chainid=1&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10000&sort=asc${key ? `&apikey=${key}` : ""}`;
  const r = await fetch(txUrl);
  const j = await r.json();
  return signalsFromTxList(j.result);
}

async function baseSignals(address: string) {
  // Blockscout Base (Etherscan-compatible), free
  const url = `https://base.blockscout.com/api?module=account&action=txlist&address=${address}&sort=asc`;
  const r = await fetch(url);
  const j = await r.json();
  return signalsFromTxList(j.result);
}

function signalsFromTxList(list: unknown) {
  if (!Array.isArray(list) || list.length === 0) {
    return { wallet_age_days: null, tx_count: 0, first_seen: null, last_seen: null, is_contract: false };
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
