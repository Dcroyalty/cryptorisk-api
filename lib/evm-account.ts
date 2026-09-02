// lib/evm-account.ts — cheap "does this EVM address exist on this chain?" check.
// Public RPC only (same fallback list as lib/live-risk.ts). No key. Used by
// /api/lookup to decide `exists` without asserting anything it hasn't verified.

const RPCS: Record<string, string[]> = {
  base: ["https://mainnet.base.org", "https://base.llamarpc.com", "https://base-rpc.publicnode.com"],
  ethereum: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"],
};

async function call(
  chain: string,
  method: string,
  params: unknown[],
  timeoutMs = 4000,
): Promise<string | null> {
  for (const url of RPCS[chain] ?? RPCS.base) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      clearTimeout(timer);
      if (j?.error || j?.result === undefined || j?.result === null) continue;
      return j.result as string;
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

export interface EvmAccountState {
  fully_checked: boolean; // code + nonce + balance all returned
  has_code: boolean;
  nonce: number;
  balance_wei: bigint;
}

export async function evmAccountState(chain: string, address: string): Promise<EvmAccountState> {
  const [code, nonce, balance] = await Promise.all([
    call(chain, "eth_getCode", [address, "latest"]),
    call(chain, "eth_getTransactionCount", [address, "latest"]),
    call(chain, "eth_getBalance", [address, "latest"]),
  ]);
  return {
    fully_checked: code !== null && nonce !== null && balance !== null,
    has_code: !!code && code !== "0x" && code !== "0x0",
    nonce: nonce ? Number(BigInt(nonce)) : 0,
    balance_wei: balance ? BigInt(balance) : BigInt(0),
  };
}
