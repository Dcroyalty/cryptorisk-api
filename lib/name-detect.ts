// lib/name-detect.ts — classify a /api/resolve query string. No network calls.
import { detectAddress } from "@/lib/address-detect";

export type Kind = "name" | "address" | "unknown";
export type Namespace = "ens" | "basename" | "xrp" | "evm" | "xrpl" | "unknown";

export interface NameDetection {
  kind: Kind;
  namespace: Namespace;
  chain: "ethereum" | "base" | "xrpl" | "evm" | "unknown";
}

// One or more DNS-style labels (ASCII letters/digits/hyphen/underscore).
// Deliberately excludes unicode/emoji — a spoof-resistant v1 subset; viem's
// normalize() rejects invalid names at resolve time anyway.
const NAMEISH = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i;

export function detectName(raw: string): NameDetection {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();

  // addresses first (unambiguous, no dots)
  const addr = detectAddress(s);
  if (addr.chain === "evm") return { kind: "address", namespace: "evm", chain: "evm" };
  if (addr.format === "xrpl-classic") return { kind: "address", namespace: "xrpl", chain: "xrpl" };

  // names — order matters: .base.eth is also .eth, so test it first
  if (NAMEISH.test(lower)) {
    if (lower.endsWith(".base.eth")) return { kind: "name", namespace: "basename", chain: "base" };
    if (lower.endsWith(".eth")) return { kind: "name", namespace: "ens", chain: "ethereum" };
    if (lower.endsWith(".xrp")) return { kind: "name", namespace: "xrp", chain: "xrpl" };
  }

  return { kind: "unknown", namespace: "unknown", chain: "unknown" };
}
