// lib/shield.ts — the stateful half of /api/shield.
//
// Ownership model: every write is a fresh EIP-191 signature over a server-issued,
// single-use nonce that also binds the operation (action + target). Reads use a
// short-lived bearer session so /check isn't a signing prompt per message.
//
// v1 verifies EOA (ECDSA) signatures only via viem's verifyMessage. ERC-1271
// (Safe / smart-contract wallets) is not supported yet — the signature-failure
// message says so explicitly.
//
// Retention: shield_events rows older than 90 days are pruned opportunistically
// on every /nonce call, alongside expired nonces and sessions.
import { randomBytes } from "node:crypto";
import { verifyMessage, isAddress } from "viem";
import { sql } from "@/lib/db";
import { composeCallerId } from "@/lib/callerid";

const NONCE_TTL_MIN = 10;
const SESSION_TTL_MIN = 60;
export const EVENT_RETENTION_DAYS = 90;
const DOMAIN = "uxus.finance";

export class ShieldError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SIG_FAIL =
  "signature did not recover to the owner address. If this is a Safe or other " +
  "smart-contract wallet, note that v1 verifies EOA (ECDSA) signatures only — " +
  "ERC-1271 verification is not supported yet.";

export type WriteAction = "block" | "unblock" | "allow" | "unallow";
export type MsgAction = WriteAction | "session";

function lc(a: string): string {
  return a.toLowerCase();
}

function assertAddress(value: string, label: string): string {
  const v = lc(value.trim());
  if (!isAddress(v)) throw new ShieldError(400, "invalid_address", `${label} is not a valid 0x address`);
  return v;
}

// ---- message construction (must byte-match what the client signs) ----

export function buildMessage(a: {
  action: MsgAction;
  owner: string;
  target?: string;
  chain?: string;
  nonce: string;
}): string {
  const lines = [
    `UXUS Shield — ${a.action}`,
    "",
    "Prove you control this address. Free, no transaction.",
    "",
    `owner: ${lc(a.owner)}`,
  ];
  if (a.action === "block" || a.action === "unblock") {
    lines.push(`target: ${lc(a.target as string)}`, `chain: ${a.chain || "evm"}`);
  } else if (a.action === "allow" || a.action === "unallow") {
    lines.push(`target: ${lc(a.target as string)}`);
  }
  lines.push(`nonce: ${a.nonce}`, `domain: ${DOMAIN}`);
  return lines.join("\n");
}

// ---- opportunistic housekeeping ----

export async function sweep(): Promise<void> {
  await sql`DELETE FROM shield_nonces WHERE expires_at < now()`;
  await sql`DELETE FROM shield_sessions WHERE expires_at < now()`;
  await sql`DELETE FROM shield_events WHERE created_at < now() - ${`${EVENT_RETENTION_DAYS} days`}::interval`;
}

// ---- nonce lifecycle ----

export async function issueNonce(
  ownerRaw: string,
): Promise<{ owner: string; nonce: string; expires_at: string }> {
  const owner = assertAddress(ownerRaw, "owner");
  const nonce = randomBytes(32).toString("hex");
  const rows = (await sql`
    INSERT INTO shield_nonces (owner, nonce, expires_at)
    VALUES (${owner}, ${nonce}, now() + ${`${NONCE_TTL_MIN} minutes`}::interval)
    ON CONFLICT (owner) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at
    RETURNING owner, nonce, expires_at
  `) as { owner: string; nonce: string; expires_at: string }[];
  return rows[0];
}

async function consumeNonce(owner: string): Promise<string> {
  const rows = (await sql`
    SELECT nonce FROM shield_nonces WHERE owner = ${owner} AND expires_at > now()
  `) as { nonce: string }[];
  if (!rows.length) {
    throw new ShieldError(
      401,
      "nonce_missing",
      "no valid nonce for this owner — GET /api/shield/nonce?owner=0x... first (nonces expire after 10 minutes and are single-use)",
    );
  }
  return rows[0].nonce;
}

async function deleteNonce(owner: string): Promise<void> {
  await sql`DELETE FROM shield_nonces WHERE owner = ${owner}`;
}

function verifySig(owner: string, message: string, signature: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new ShieldError(400, "invalid_signature", "signature must be a 0x-prefixed hex string");
  }
  return verifyMessage({
    address: owner as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);
}

// ---- sessions (reads) ----

export async function createSession(
  ownerRaw: string,
  signature: string,
): Promise<{ token: string; owner: string; expires_at: string }> {
  const owner = assertAddress(ownerRaw, "owner");
  const nonce = await consumeNonce(owner);
  const message = buildMessage({ action: "session", owner, nonce });
  if (!(await verifySig(owner, message, signature))) {
    throw new ShieldError(401, "signature_invalid", SIG_FAIL);
  }
  await deleteNonce(owner);
  const token = randomBytes(32).toString("hex");
  const rows = (await sql`
    INSERT INTO shield_sessions (token, owner, expires_at)
    VALUES (${token}, ${owner}, now() + ${`${SESSION_TTL_MIN} minutes`}::interval)
    RETURNING token, owner, expires_at
  `) as { token: string; owner: string; expires_at: string }[];
  return rows[0];
}

export async function ownerFromBearer(authHeader: string | null): Promise<string> {
  const m = (authHeader || "").match(/^Bearer\s+([0-9a-fA-F]{64})$/);
  if (!m) {
    throw new ShieldError(
      401,
      "no_session",
      "missing or malformed Authorization header — expected 'Bearer <token>' from POST /api/shield/session",
    );
  }
  const rows = (await sql`
    SELECT owner FROM shield_sessions WHERE token = ${m[1].toLowerCase()} AND expires_at > now()
  `) as { owner: string }[];
  if (!rows.length) {
    throw new ShieldError(
      401,
      "session_expired",
      "session token is invalid or expired — POST /api/shield/session for a new one (sessions last 60 minutes)",
    );
  }
  return rows[0].owner;
}

// ---- writes ----

export async function applyWrite(
  action: WriteAction,
  ownerRaw: string,
  signature: string,
  targetRaw: string,
  opts: { chain?: string; reason?: string },
): Promise<Record<string, unknown>> {
  const owner = assertAddress(ownerRaw, "owner");
  const target = assertAddress(targetRaw, "address");
  const chain = (opts.chain || "evm").toLowerCase();
  const reason = opts.reason ? String(opts.reason).slice(0, 500) : null;

  const nonce = await consumeNonce(owner);
  const message = buildMessage({ action, owner, target, chain, nonce });
  if (!(await verifySig(owner, message, signature))) {
    throw new ShieldError(401, "signature_invalid", SIG_FAIL);
  }
  await deleteNonce(owner); // single-use

  if (action === "block") {
    await sql`
      INSERT INTO shield_blocks (owner, blocked_address, chain, reason, source)
      VALUES (${owner}, ${target}, ${chain}, ${reason}, 'manual')
      ON CONFLICT (owner, blocked_address)
      DO UPDATE SET chain = EXCLUDED.chain, reason = EXCLUDED.reason, source = 'manual'
    `;
    return { ok: true, action, owner, address: target, chain, reason };
  }
  if (action === "unblock") {
    const r = (await sql`
      DELETE FROM shield_blocks WHERE owner = ${owner} AND blocked_address = ${target} RETURNING 1
    `) as unknown[];
    return { ok: true, action, owner, address: target, removed: r.length > 0 };
  }
  if (action === "allow") {
    await sql`
      INSERT INTO shield_allows (owner, address, reason)
      VALUES (${owner}, ${target}, ${reason})
      ON CONFLICT (owner, address) DO UPDATE SET reason = EXCLUDED.reason
    `;
    return { ok: true, action, owner, address: target, reason };
  }
  // unallow
  const r = (await sql`
    DELETE FROM shield_allows WHERE owner = ${owner} AND address = ${target} RETURNING 1
  `) as unknown[];
  return { ok: true, action, owner, address: target, removed: r.length > 0 };
}

// ---- reads ----

export async function listLists(owner: string): Promise<Record<string, unknown>> {
  const blocks = (await sql`
    SELECT blocked_address AS address, chain, reason, source, created_at
    FROM shield_blocks WHERE owner = ${owner} ORDER BY created_at DESC
  `) as unknown[];
  const allows = (await sql`
    SELECT address, reason, created_at
    FROM shield_allows WHERE owner = ${owner} ORDER BY created_at DESC
  `) as unknown[];
  return { owner, blocks, allows, counts: { blocks: blocks.length, allows: allows.length } };
}

const SANCTIONED = "sanctioned";

export async function checkAddress(
  owner: string,
  addressRaw: string,
  chain: "base" | "ethereum",
): Promise<Record<string, unknown>> {
  const address = assertAddress(addressRaw, "address");

  const [blockRows, allowRows, composed] = await Promise.all([
    sql`SELECT reason, source FROM shield_blocks WHERE owner = ${owner} AND blocked_address = ${address}` as Promise<
      { reason: string | null; source: string }[]
    >,
    sql`SELECT 1 FROM shield_allows WHERE owner = ${owner} AND address = ${address}` as Promise<unknown[]>,
    composeCallerId(address, chain),
  ]);

  const block = blockRows[0] ?? null;
  const allowed = allowRows.length > 0;
  const { entity, name, result: rec } = composed;
  const category = entity?.category ?? null;

  let blocked: boolean;
  let source: string | null;
  let reasons: string[];

  if (category === SANCTIONED) {
    blocked = true;
    source = "sanctioned";
    reasons = ["entity category: sanctioned — hard stop, cannot be allowlisted"];
  } else if (allowed) {
    blocked = false;
    source = "allow";
    reasons = ["on your allowlist"];
  } else if (block) {
    blocked = true;
    source = "manual";
    reasons = [block.reason || "manually blocked"];
  } else if (rec.recommendation === "BLOCK") {
    blocked = true;
    source = "auto";
    reasons = rec.reasons;
  } else {
    blocked = false;
    source = null;
    reasons = rec.reasons;
  }

  const recommendation = blocked ? "BLOCK" : rec.recommendation;
  const action = blocked ? "blocked" : recommendation === "ANSWER" ? "allowed" : "screened";

  await sql`
    INSERT INTO shield_events (owner, address, action, recommendation, category)
    VALUES (${owner}, ${address}, ${action}, ${recommendation}, ${category})
  `;

  return {
    address,
    owner,
    blocked,
    source,
    recommendation,
    confidence: rec.confidence,
    reasons,
    entity: entity ?? { is_known: false, label: null, category: "unknown" },
    name,
    checked_at: new Date().toISOString(),
  };
}

export async function stats(owner: string): Promise<Record<string, unknown>> {
  const rows = (await sql`
    SELECT
      action,
      coalesce(category, 'unknown') AS category,
      count(*) FILTER (WHERE created_at > now() - ${"7 days"}::interval)::int  AS d7,
      count(*) FILTER (WHERE created_at > now() - ${"30 days"}::interval)::int AS d30,
      count(*) FILTER (WHERE created_at > now() - ${"90 days"}::interval)::int AS d90
    FROM shield_events
    WHERE owner = ${owner}
    GROUP BY action, category
  `) as { action: string; category: string; d7: number; d30: number; d90: number }[];

  const windows: Record<string, { total: number; by_action: Record<string, number>; blocked_by_category: Record<string, number> }> = {
    "7d": { total: 0, by_action: {}, blocked_by_category: {} },
    "30d": { total: 0, by_action: {}, blocked_by_category: {} },
    "90d": { total: 0, by_action: {}, blocked_by_category: {} },
  };
  const keyOf: Record<string, "d7" | "d30" | "d90"> = { "7d": "d7", "30d": "d30", "90d": "d90" };

  for (const [win, field] of Object.entries(keyOf)) {
    for (const r of rows) {
      const n = r[field];
      if (!n) continue;
      windows[win].total += n;
      windows[win].by_action[r.action] = (windows[win].by_action[r.action] || 0) + n;
      if (r.action === "blocked") {
        windows[win].blocked_by_category[r.category] =
          (windows[win].blocked_by_category[r.category] || 0) + n;
      }
    }
  }

  const [{ blocks }] = (await sql`SELECT count(*)::int AS blocks FROM shield_blocks WHERE owner = ${owner}`) as {
    blocks: number;
  }[];
  const [{ allows }] = (await sql`SELECT count(*)::int AS allows FROM shield_allows WHERE owner = ${owner}`) as {
    allows: number;
  }[];

  return {
    owner,
    retention_days: EVENT_RETENTION_DAYS,
    list_size: { blocks, allows },
    windows,
  };
}
