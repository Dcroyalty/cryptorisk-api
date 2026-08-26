// lib/live-risk.ts â€” MUTABLE RISK ENGINE
//
// The wedge: every other scanner (GoPlus, Honeypot.is, ApeSpace) answers
// "is this token safe RIGHT NOW?" They all carry the same disclaimer â€”
// "a token that isn't a honeypot now could become one in the future."
// A snapshot is useless to a bot that HOLDS a position.
//
// This answers the question they don't: "can the owner turn hostile on me
// while I'm holding, and how fast?" Pure on-chain reads (eth_call +
// eth_getStorageAt) against public Base/Ethereum RPC. No third-party
// security API in the hot path -> faster, cheaper, no rate-limit ceiling.

export type Chain = "base" | "ethereum";

const RPCS: Record<Chain, string[]> = {
  base: ["https://mainnet.base.org", "https://base.llamarpc.com", "https://base-rpc.publicnode.com"],
  ethereum: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"],
};

// Verified selectors (keccak256 of signature, first 4 bytes)
const SEL = {
  owner: "0x8da5cb5b",
  getOwner: "0x893d20e8",
  pendingOwner: "0xe30c3978",
  paused: "0x5c975abb",
  implementation: "0x5c60da1b",
  symbol: "0x95d89b41",
} as const;

// EIP-1967 standard slots (keccak256(id) - 1)
const SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = new Set([ZERO, "0x000000000000000000000000000000000000dead"]);

let rpcIndex = 0;

async function rpc<T = string>(chain: Chain, method: string, params: unknown[], timeoutMs = 4000): Promise<T | null> {
  const urls = RPCS[chain];
  for (let attempt = 0; attempt < urls.length; attempt++) {
    const url = urls[(rpcIndex + attempt) % urls.length];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      clearTimeout(timer);
      if (j?.error) continue;
      if (j?.result !== undefined) {
        rpcIndex = (rpcIndex + attempt) % urls.length; // stick to the healthy node
        return j.result as T;
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

const call = (chain: Chain, to: string, data: string) =>
  rpc<string>(chain, "eth_call", [{ to, data }, "latest"]);

const isEmpty = (hex: string | null) => !hex || hex === "0x" || /^0x0*$/.test(hex);
const addrFromWord = (hex: string | null): string | null => {
  if (!hex || hex.length < 66) return null;
  const a = "0x" + hex.slice(-40).toLowerCase();
  return a === ZERO ? null : a;
};
// Distinguishes three states that matter:
//   "0x" / null  -> paused() does not exist  => no pause power  (null)
//   0x000...000  -> exists, currently false  => CAN pause       (false)
//   0x000...001  -> exists, currently true   => IS paused       (true)
const pauseState = (hex: string | null): boolean | null => {
  if (!hex || hex === "0x" || hex.length < 66) return null; // no such function
  try { return BigInt(hex) === BigInt(1); } catch { return null; }
};

function decodeString(hex: string | null): string | null {
  if (!hex || hex.length < 130) return null;
  try {
    const len = Number(BigInt("0x" + hex.slice(66, 130)));
    if (!len || len > 64) return null;
    const bytes = hex.slice(130, 130 + len * 2);
    return Buffer.from(bytes, "hex").toString("utf8").replace(/\0/g, "") || null;
  } catch { return null; }
}

export interface LiveRisk {
  address: string;
  chain: Chain;
  symbol: string | null;
  is_contract: boolean;
  // the differentiator
  mutable_risk_score: number;      // 0-100, how much the owner can still hurt you
  can_turn_hostile: boolean;
  time_to_rug: "instant" | "delayed" | "impossible" | "unknown";
  verdict: "SAFE_TO_HOLD" | "MONITOR" | "EXIT_RISK" | "DO_NOT_HOLD";
  powers: string[];                // what the owner can still do to you
  controls: {
    owner: string | null;
    ownership_renounced: boolean;
    is_upgradeable_proxy: boolean;
    proxy_admin: string | null;
    implementation: string | null;
    has_pause: boolean;
    is_paused: boolean | null;
    pending_owner: string | null;
  };
  checked_at: string;
  latency_ms: number;
  rpc_ok: boolean;   // false = we could not reach chain; treat result as UNKNOWN, not safe
}

export async function analyzeLiveRisk(address: string, chain: Chain): Promise<LiveRisk> {
  const t0 = Date.now();
  const addr = address.toLowerCase();

  // Everything in parallel â€” this is why we're fast.
  const [code, ownerRaw, getOwnerRaw, pendingRaw, pausedRaw, implRaw, implSlot, adminSlot, symbolRaw] =
    await Promise.all([
      rpc<string>(chain, "eth_getCode", [addr, "latest"]),
      call(chain, addr, SEL.owner),
      call(chain, addr, SEL.getOwner),
      call(chain, addr, SEL.pendingOwner),
      call(chain, addr, SEL.paused),
      call(chain, addr, SEL.implementation),
      rpc<string>(chain, "eth_getStorageAt", [addr, SLOT_IMPL, "latest"]),
      rpc<string>(chain, "eth_getStorageAt", [addr, SLOT_ADMIN, "latest"]),
      call(chain, addr, SEL.symbol),
    ]);

  // Fail CLOSED. If the chain was unreachable, never report "safe".
  const rpc_ok = code !== null;
  if (!rpc_ok) {
    return {
      address: addr, chain, symbol: null, is_contract: false,
      mutable_risk_score: 50, can_turn_hostile: true, time_to_rug: "unknown",
      verdict: "MONITOR", powers: ["RPC_UNAVAILABLE_RESULT_UNKNOWN"],
      controls: { owner: null, ownership_renounced: false, is_upgradeable_proxy: false,
        proxy_admin: null, implementation: null, has_pause: false, is_paused: null, pending_owner: null },
      checked_at: new Date().toISOString(), latency_ms: Date.now() - t0, rpc_ok: false,
    };
  }

  const is_contract = code !== "0x" && code.length > 4;

  const owner = addrFromWord(ownerRaw) ?? addrFromWord(getOwnerRaw);
  const ownership_renounced = !owner || DEAD.has(owner);
  const implementation = addrFromWord(implRaw) ?? addrFromWord(implSlot);
  const proxy_admin = addrFromWord(adminSlot);
  const is_upgradeable_proxy = !!implementation;
  const is_paused = pauseState(pausedRaw);
  const has_pause = is_paused !== null;
  const pending_owner = addrFromWord(pendingRaw);

  const powers: string[] = [];
  let score = 0;

  if (!is_contract) {
    return {
      address: addr, chain, symbol: null, is_contract: false,
      mutable_risk_score: 0, can_turn_hostile: false, time_to_rug: "impossible",
      verdict: "SAFE_TO_HOLD", powers: ["NOT_A_CONTRACT"],
      controls: { owner: null, ownership_renounced: true, is_upgradeable_proxy: false,
        proxy_admin: null, implementation: null, has_pause: false, is_paused: null, pending_owner: null },
      checked_at: new Date().toISOString(), latency_ms: Date.now() - t0, rpc_ok: true,
    };
  }

  // --- The scoring that no snapshot scanner does ---
  if (is_upgradeable_proxy) {
    // Worst case: logic can be swapped for hostile code in ONE transaction.
    score += 55;
    powers.push("OWNER_CAN_REPLACE_ALL_CONTRACT_LOGIC");
    if (proxy_admin && !DEAD.has(proxy_admin)) powers.push("PROXY_ADMIN_ACTIVE");
  }
  if (!ownership_renounced) {
    score += 25;
    powers.push("OWNER_RETAINS_PRIVILEGES");
  }
  if (is_paused === true) {
    score += 20;
    powers.push("CURRENTLY_PAUSED_TRANSFERS_BLOCKED");
  } else if (is_paused === false) {
    score += 15;
    powers.push("OWNER_CAN_PAUSE_ALL_TRANSFERS");
  }
  if (pending_owner) {
    score += 10;
    powers.push("OWNERSHIP_TRANSFER_PENDING");
  }
  if (ownership_renounced && !is_upgradeable_proxy) powers.push("CONTROLS_LOCKED");

  score = Math.max(0, Math.min(100, score));

  const can_turn_hostile = score >= 25;
  const time_to_rug: LiveRisk["time_to_rug"] =
    is_upgradeable_proxy || is_paused === true ? "instant"
    : is_paused === false ? "instant"
    : !ownership_renounced ? "delayed"
    : score === 0 ? "impossible" : "unknown";

  const verdict: LiveRisk["verdict"] =
    score >= 70 ? "DO_NOT_HOLD" : score >= 40 ? "EXIT_RISK" : score >= 20 ? "MONITOR" : "SAFE_TO_HOLD";

  return {
    address: addr, chain, symbol: decodeString(symbolRaw), is_contract,
    mutable_risk_score: score, can_turn_hostile, time_to_rug, verdict, powers,
    controls: {
      owner, ownership_renounced, is_upgradeable_proxy, proxy_admin, implementation,
      has_pause, is_paused, pending_owner,
    },
    checked_at: new Date().toISOString(),
    latency_ms: Date.now() - t0,
    rpc_ok: true,
  };
}
