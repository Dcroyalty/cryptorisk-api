// lib/resolve.ts — ENS + Basenames name <-> address resolution.
// Public RPC fallback (same pattern as lib/live-risk.ts), no third-party API key.
// viem is used only for namehash / ABI encode-decode / the fallback transport —
// it calls the resolver contracts directly, it is not a hosted service.
//
// FORWARD-VERIFY on reverse is load-bearing: a reverse record is user-set and can
// claim any name, so we resolve the claimed name forward and require it to match
// the input address. No match -> no result.
import {
  createPublicClient,
  http,
  fallback,
  namehash,
  keccak256,
  toHex,
  encodePacked,
  getAddress,
} from "viem";
import { normalize } from "viem/ens";
import { mainnet, base } from "viem/chains";

const MAINNET_RPCS = [
  "https://eth.llamarpc.com",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
];
const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
];

const mc = createPublicClient({
  chain: mainnet,
  transport: fallback(MAINNET_RPCS.map((u) => http(u))),
});
const bc = createPublicClient({
  chain: base,
  transport: fallback(BASE_RPCS.map((u) => http(u))),
});

const BASENAMES_REGISTRY = "0xb94704422c2a1e396835a571837aa5ae53285a95" as const;
// ENSIP-11 Base coinType: 0x80000000 + 8453 = 0x80002105
const BASE_REVERSE_NODE = namehash("80002105.reverse");
const ZERO = "0x0000000000000000000000000000000000000000";

const REG_ABI = [
  { name: "resolver", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;
const RES_ABI = [
  { name: "addr", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "string" }] },
] as const;

export interface Resolution {
  resolved: boolean;
  address: string | null;
  name: string | null;
  namespace: "ens" | "basename" | null;
  chain: "ethereum" | "base" | null;
  sources: string[];
  note?: string;
}

function miss(ns: "ens" | "basename", chain: "ethereum" | "base", echoName: string): Resolution {
  return { resolved: false, address: null, name: echoName || null, namespace: ns, chain, sources: [] };
}

// ---- ENS (Ethereum mainnet) — via viem's ENS Universal Resolver ----
// viem's getEnsName forward-verifies the reverse record on-chain (Universal
// Resolver's reverse() does the round-trip), so a spoofed reverse record yields null.
async function ensForward(name: string): Promise<Resolution> {
  try {
    const norm = normalize(name);
    const addr = await mc.getEnsAddress({ name: norm });
    if (!addr || addr === ZERO) return miss("ens", "ethereum", name);
    return { resolved: true, address: addr.toLowerCase(), name: norm, namespace: "ens", chain: "ethereum", sources: ["ens"] };
  } catch {
    return miss("ens", "ethereum", name);
  }
}
async function ensReverse(address: string): Promise<Resolution | null> {
  try {
    const name = await mc.getEnsName({ address: getAddress(address) });
    if (!name) return null;
    return { resolved: true, address: address.toLowerCase(), name, namespace: "ens", chain: "ethereum", sources: ["ens"] };
  } catch {
    return null;
  }
}

// ---- Basenames (Base) — registry -> resolver, with our own forward-verify ----
async function basenameForward(name: string): Promise<Resolution> {
  try {
    const node = namehash(normalize(name));
    const resolver = await bc.readContract({ address: BASENAMES_REGISTRY, abi: REG_ABI, functionName: "resolver", args: [node] });
    if (!resolver || resolver === ZERO) return miss("basename", "base", name);
    const addr = (await bc
      .readContract({ address: resolver, abi: RES_ABI, functionName: "addr", args: [node] })
      .catch(() => null)) as string | null;
    if (!addr || addr === ZERO) return miss("basename", "base", name);
    return { resolved: true, address: addr.toLowerCase(), name: normalize(name), namespace: "basename", chain: "base", sources: ["basenames"] };
  } catch {
    return miss("basename", "base", name);
  }
}
async function basenameReverse(address: string): Promise<Resolution | null> {
  try {
    const hexAddr = address.toLowerCase().replace(/^0x/, "");
    const rnode = keccak256(encodePacked(["bytes32", "bytes32"], [BASE_REVERSE_NODE, keccak256(toHex(hexAddr))]));
    const resolver = await bc.readContract({ address: BASENAMES_REGISTRY, abi: REG_ABI, functionName: "resolver", args: [rnode] });
    if (!resolver || resolver === ZERO) return null;
    const name = (await bc
      .readContract({ address: resolver, abi: RES_ABI, functionName: "name", args: [rnode] })
      .catch(() => null)) as string | null;
    if (!name) return null;
    // FORWARD-VERIFY — required. The reverse record is user-set.
    const fwd = await basenameForward(name);
    if (!fwd.resolved || fwd.address !== address.toLowerCase()) return null;
    return { resolved: true, address: address.toLowerCase(), name, namespace: "basename", chain: "base", sources: ["basenames"] };
  } catch {
    return null;
  }
}

export async function resolveForward(name: string, namespace: "ens" | "basename"): Promise<Resolution> {
  return namespace === "basename" ? basenameForward(name) : ensForward(name);
}

export async function resolveReverse(address: string): Promise<Resolution> {
  const ens = await ensReverse(address);
  if (ens) return ens;
  const bn = await basenameReverse(address);
  if (bn) return bn;
  return { resolved: false, address: address.toLowerCase(), name: null, namespace: null, chain: null, sources: [] };
}

// Best-effort primary name for the /api/lookup cross-link (parallel, non-throwing).
export async function primaryName(address: string): Promise<{ name: string; namespace: string } | null> {
  const [e, b] = await Promise.allSettled([ensReverse(address), basenameReverse(address)]);
  const ev = e.status === "fulfilled" ? e.value : null;
  const bv = b.status === "fulfilled" ? b.value : null;
  if (ev?.resolved && ev.name) return { name: ev.name, namespace: "ens" };
  if (bv?.resolved && bv.name) return { name: bv.name, namespace: "basename" };
  return null;
}
