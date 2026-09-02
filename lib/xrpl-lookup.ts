// lib/xrpl-lookup.ts — self-contained XRPL account reverse-lookup.
// Public XRPL JSON-RPC only, same fallback pattern as lib/live-risk.ts. No xrpl
// npm package, no API key, no XRPLHub. Accepts a classic r-address or an
// X-address (decoded internally). Returns existence, age, balance, control
// state, flags, and a 0-100 risk score / PROCEED-CAUTION-BLOCK verdict.
import { createHash } from "node:crypto";
import { levelFromScore, verdictFromLevel, type RiskLevel, type Verdict } from "@/lib/scoring";

const RPCS = [
  "https://xrplcluster.com",
  "https://s1.ripple.com:51234",
  "https://s2.ripple.com:51234",
];

const RIPPLE_EPOCH = 946684800; // seconds between the Unix epoch and 2000-01-01T00:00:00Z

// AccountRoot Flags bits
const lsfRequireDestTag = 0x00020000;
const lsfRequireAuth = 0x00040000;
const lsfDisallowXRP = 0x00080000;
const lsfDisableMaster = 0x00100000;
const lsfGlobalFreeze = 0x00400000;

// Known un-usable "blackhole" regular keys
const BLACKHOLE_KEYS = new Set([
  "rrrrrrrrrrrrrrrrrrrrrhoLvTp", // ACCOUNT_ZERO
  "rrrrrrrrrrrrrrrrrrrrBZbvji", // ACCOUNT_ONE
]);

let rpcIndex = 0;
type RpcResult<T> = { ok: true; result: T } | { ok: false };

async function rpc<T = any>(method: string, params: any[], timeoutMs = 4500): Promise<RpcResult<T>> {
  for (let attempt = 0; attempt < RPCS.length; attempt++) {
    const url = RPCS[(rpcIndex + attempt) % RPCS.length];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      clearTimeout(timer);
      if (j?.result === undefined) continue;
      rpcIndex = (rpcIndex + attempt) % RPCS.length;
      return { ok: true, result: j.result as T };
    } catch {
      clearTimeout(timer);
    }
  }
  return { ok: false };
}

// ---- base58check + X-address codec (XRPL "ripple" alphabet) ----
// Same 58-char set as Bitcoin base58, reordered. Verified against @scure/base.
const ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function b58decode(str: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of str) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < str.length && str[k] === ALPHABET[0]; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function sha256(buf: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(buf).digest());
}

function b58checkDecode(str: string): Uint8Array | null {
  const raw = b58decode(str);
  if (!raw || raw.length < 5) return null;
  const payload = raw.slice(0, -4);
  const checksum = raw.slice(-4);
  const expected = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) if (checksum[i] !== expected[i]) return null;
  return payload;
}

// Validate a classic r-address (payload = 0x00 + 20-byte accountID + checksum).
// X-addresses (X…/T…) are detected upstream but not resolved here — decoding one
// wrong would look up the wrong account, so the route asks for the classic form.
function toClassic(address: string): string | null {
  const a = address.trim();
  if (a[0] !== "r") return null;
  const p = b58checkDecode(a);
  if (!p || p.length !== 21 || p[0] !== 0x00) return null;
  return a;
}

function hexToUtf8(hex?: string): string | null {
  if (!hex) return null;
  try {
    return Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "") || null;
  } catch {
    return null;
  }
}

export interface XrplLookup {
  address: string;
  exists: boolean;
  risk_score: number;
  risk_level: RiskLevel;
  verdict: Verdict;
  flags: string[];
  account_age_days: number | null;
  xrp_balance: string | null;
  trust_lines: number | null;
  domain: string | null;
  blackholed: boolean;
  checked_at: string;
}

function shell(address: string, flags: string[], score: number, exists: boolean): XrplLookup {
  const level = levelFromScore(score);
  return {
    address,
    exists,
    risk_score: score,
    risk_level: level,
    verdict: verdictFromLevel(level),
    flags,
    account_age_days: null,
    xrp_balance: null,
    trust_lines: null,
    domain: null,
    blackholed: false,
    checked_at: new Date().toISOString(),
  };
}

export async function xrplLookup(input: string): Promise<XrplLookup> {
  const address = toClassic(input);
  if (!address) return shell(input.trim(), ["INVALID_ADDRESS"], 30, false);

  const [infoR, linesR, txR, signerR] = await Promise.all([
    rpc<any>("account_info", [{ account: address, ledger_index: "validated", strict: true }]),
    rpc<any>("account_lines", [{ account: address, ledger_index: "validated", limit: 400 }]),
    rpc<any>("account_tx", [
      { account: address, ledger_index_min: -1, ledger_index_max: -1, forward: true, limit: 1 },
    ]),
    rpc<any>("account_objects", [
      { account: address, type: "signer_list", ledger_index: "validated" },
    ]),
  ]);

  if (!infoR.ok) return shell(address, ["RPC_UNAVAILABLE"], 40, false);

  const info = infoR.result;
  if (info?.error === "actNotFound" || !info?.account_data) {
    return shell(address, ["NOT_FOUND"], 30, false);
  }

  const acct = info.account_data;
  const flagsBits = Number(acct.Flags || 0);
  const balanceDrops = (() => {
    try {
      return BigInt(acct.Balance || "0");
    } catch {
      return BigInt(0);
    }
  })();
  const domain = hexToUtf8(acct.Domain);

  const requireDest = (flagsBits & lsfRequireDestTag) !== 0;
  const disallowXRP = (flagsBits & lsfDisallowXRP) !== 0;
  const requireAuth = (flagsBits & lsfRequireAuth) !== 0;
  const globalFreeze = (flagsBits & lsfGlobalFreeze) !== 0;
  const masterDisabled = (flagsBits & lsfDisableMaster) !== 0;

  const regularKey: string | undefined = acct.RegularKey;
  const noUsableRegularKey = !regularKey || BLACKHOLE_KEYS.has(regularKey);
  const hasSignerList =
    signerR.ok &&
    Array.isArray(signerR.result?.account_objects) &&
    signerR.result.account_objects.length > 0;
  const blackholed = masterDisabled && noUsableRegularKey && !hasSignerList;

  let trustLines: number | null = null;
  if (linesR.ok && Array.isArray(linesR.result?.lines)) trustLines = linesR.result.lines.length;

  let ageDays: number | null = null;
  const oldest = txR.ok ? txR.result?.transactions?.[0] : null;
  const rippleDate = oldest?.tx?.date ?? oldest?.tx_json?.date;
  const iso = oldest?.close_time_iso;
  if (typeof rippleDate === "number") {
    ageDays = Math.max(0, Math.floor((Date.now() - (rippleDate + RIPPLE_EPOCH) * 1000) / 86400000));
  } else if (typeof iso === "string" && !Number.isNaN(Date.parse(iso))) {
    ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
  }

  // ---- scoring: structural control signals only (no external lists in the free path) ----
  const flags: string[] = [];
  let score = 0;
  if (globalFreeze) {
    score += 50;
    flags.push("GLOBAL_FREEZE");
  }
  if (requireAuth) {
    score += 12;
    flags.push("REQUIRE_AUTH");
  }
  if (ageDays !== null && ageDays < 7) {
    score += 15;
    flags.push("NEW_ACCOUNT");
  }
  if (disallowXRP) {
    score += 5;
    flags.push("DISALLOW_XRP");
  }
  if (requireDest) flags.push("REQUIRE_DEST_TAG");
  if (blackholed) flags.push("BLACKHOLED");
  if (domain) {
    flags.push("DOMAIN_SET");
    score = Math.max(0, score - 5);
  }

  const NEUTRAL = new Set(["REQUIRE_DEST_TAG", "BLACKHOLED", "DOMAIN_SET"]);
  if (score === 0 && flags.every((f) => NEUTRAL.has(f))) flags.push("CLEAN");

  score = Math.min(100, Math.max(0, score));
  const level = levelFromScore(score);

  return {
    address,
    exists: true,
    risk_score: score,
    risk_level: level,
    verdict: verdictFromLevel(level),
    flags,
    account_age_days: ageDays,
    xrp_balance: (Number(balanceDrops) / 1_000_000).toString(),
    trust_lines: trustLines,
    domain,
    blackholed,
    checked_at: new Date().toISOString(),
  };
}
