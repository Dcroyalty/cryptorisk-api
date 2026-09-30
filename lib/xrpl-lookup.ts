// lib/xrpl-lookup.ts — self-contained XRPL account reverse-lookup.
// Public XRPL JSON-RPC via lib/xrpl-nodes.ts (rotation, cooldown, and the
// stale / amendment-blocked node defense). No xrpl npm package, no API key.
// Accepts a classic r-address. Returns existence, age, balance, control
// state, flags, and a 0-100 risk score / PROCEED-CAUTION-BLOCK verdict.
import { createHash } from "node:crypto";
import { levelFromScore, verdictFromLevel, type RiskLevel, type Verdict } from "@/lib/scoring";
import { xrplRpc as rpc } from "@/lib/xrpl-nodes";

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
  // null = could not be determined (RPC unreachable). Never guessed.
  exists: boolean | null;
  // null = not scored (address invalid, or account state unavailable).
  risk_score: number | null;
  risk_level: RiskLevel | null;
  verdict: Verdict | null;
  flags: string[];
  account_age_days: number | null;
  xrp_balance: string | null;
  trust_lines: number | null;
  domain: string | null;
  blackholed: boolean;
  checked_at: string;
}

// A non-scored result. `score` null => risk_score/level/verdict all null (we did
// not compute a score, so we do not assert one).
function shell(
  address: string,
  flags: string[],
  score: number | null,
  exists: boolean | null,
): XrplLookup {
  const level = score === null ? null : levelFromScore(score);
  return {
    address,
    exists,
    risk_score: score,
    risk_level: level,
    verdict: level === null ? null : verdictFromLevel(level),
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
  // invalid checksum — the route turns this into a 400
  if (!address) return shell(input.trim(), ["INVALID_ADDRESS"], null, null);

  const [infoR, linesR, txR, signerR] = await Promise.all([
    rpc<any>("account_info", { account: address, ledger_index: "validated", strict: true }),
    rpc<any>("account_lines", { account: address, ledger_index: "validated", limit: 400 }),
    rpc<any>("account_tx", { account: address, ledger_index_min: -1, ledger_index_max: -1, forward: true, limit: 1 }),
    rpc<any>("account_objects", { account: address, type: "signer_list", ledger_index: "validated" }),
  ]);

  // The node ring disagrees on the current ledger — refuse rather than read a
  // possibly-stale state. The route turns this into a 503.
  if (!infoR.ok && infoR.reason === "no_majority") return shell(address, ["XRPL_NO_MAJORITY"], null, null);
  // Could not reach any XRPL node — we know nothing. Do not assert existence or risk.
  if (!infoR.ok) return shell(address, ["RPC_UNAVAILABLE"], null, null);

  const info = infoR.result;
  // Definitive answer from the ledger: the account is not funded / does not exist.
  if (info?.error === "actNotFound") return shell(address, ["NOT_FOUND"], null, false);
  // Any other node error (tooBusy, noNetwork, ...) is "could not read", not "does not exist".
  if (!info?.account_data) return shell(address, ["RPC_UNAVAILABLE"], null, null);

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
  // Only assert blackholed when the signer-list read actually succeeded.
  const blackholed = masterDisabled && noUsableRegularKey && signerR.ok && !hasSignerList;

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
