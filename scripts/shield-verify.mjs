// scripts/shield-verify.mjs — end-to-end live check of /api/shield.
//   BASE=https://uxus.finance node scripts/shield-verify.mjs
// Generates a throwaway owner wallet (never PAY_TO), runs the full flow:
// session -> block -> check(blocked) -> unblock -> check -> allow(scam) ->
// check(allowed) -> check(sanctioned, still blocked).
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "https://uxus.finance";
const DOMAIN = "uxus.finance";

const dbUrl =
  process.env.DATABASE_URL ||
  (readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
const sql = neon(dbUrl);

const account = privateKeyToAccount(generatePrivateKey());
const owner = account.address.toLowerCase();
console.log("test owner:", owner, "(throwaway)\n");

function buildMessage({ action, target, chain, nonce }) {
  const lines = [
    `UXUS Shield — ${action}`,
    "",
    "Prove you control this address. Free, no transaction.",
    "",
    `owner: ${owner}`,
  ];
  if (action === "block" || action === "unblock") lines.push(`target: ${target.toLowerCase()}`, `chain: ${chain || "evm"}`);
  else if (action === "allow" || action === "unallow") lines.push(`target: ${target.toLowerCase()}`);
  lines.push(`nonce: ${nonce}`, `domain: ${DOMAIN}`);
  return lines.join("\n");
}

async function getNonce() {
  const r = await fetch(`${BASE}/api/shield/nonce?owner=${owner}`);
  const j = await r.json();
  if (!j.nonce) throw new Error(`nonce failed: ${r.status} ${JSON.stringify(j)}`);
  return j.nonce;
}

async function signedPost(action, body) {
  const nonce = await getNonce();
  const message = buildMessage({ action, target: body.address, chain: body.chain, nonce });
  const signature = await account.signMessage({ message });
  const r = await fetch(`${BASE}/api/shield/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner, signature, ...body }),
  });
  return { status: r.status, json: await r.json() };
}

let TOKEN;
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: r.status, json: await r.json() };
}

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);

// pick real fixtures from the live label set
const [scamRow] = await sql`SELECT address FROM entity_labels WHERE category = 'scam' AND chain IN ('evm','ethereum','base') LIMIT 1`;
const [sancRow] = await sql`SELECT address FROM entity_labels WHERE category = 'sanctioned' AND chain IN ('evm','ethereum') LIMIT 1`;
const SCAM = scamRow.address.toLowerCase();
const SANCTIONED = sancRow.address.toLowerCase();
const RANDOM = "0x1111111111111111111111111111111111111111";
console.log("scam fixture:      ", SCAM);
console.log("sanctioned fixture:", SANCTIONED, "\n");

// 1. session
{
  const nonce = await getNonce();
  const message = buildMessage({ action: "session", nonce });
  const signature = await account.signMessage({ message });
  const r = await fetch(`${BASE}/api/shield/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner, signature }),
  });
  const j = await r.json();
  TOKEN = j.token;
  ok("session issues bearer token", r.status === 200 && /^[0-9a-f]{64}$/.test(j.token || ""), `status ${r.status}`);
}

// 2. block RANDOM
{
  const { status, json } = await signedPost("block", { address: RANDOM, chain: "base", reason: "test block" });
  ok("block accepts signed write", status === 200 && json.ok === true, `status ${status}`);
}

// 3. check RANDOM -> blocked, source manual
{
  const { json } = await get(`/api/shield/check?address=${RANDOM}&chain=base`);
  ok("check: blocked address returns blocked=true source=manual", json.blocked === true && json.source === "manual", `source=${json.source} rec=${json.recommendation}`);
}

// 4. unblock RANDOM
{
  const { status, json } = await signedPost("unblock", { address: RANDOM, chain: "base" });
  ok("unblock removes the block", status === 200 && json.removed === true, `status ${status}`);
}

// 5. check RANDOM -> not manually blocked
{
  const { json } = await get(`/api/shield/check?address=${RANDOM}&chain=base`);
  ok("check: after unblock, source != manual", json.source !== "manual", `blocked=${json.blocked} source=${json.source}`);
}

// 6. allow the scam address
{
  const { status, json } = await signedPost("allow", { address: SCAM, reason: "vouched" });
  ok("allow accepts signed write", status === 200 && json.ok === true, `status ${status}`);
}

// 7. check scam -> flips to allowed
{
  const { json } = await get(`/api/shield/check?address=${SCAM}&chain=ethereum`);
  ok("check: allowlisted scam flips to blocked=false source=allow", json.blocked === false && json.source === "allow", `blocked=${json.blocked} source=${json.source} rec=${json.recommendation}`);
}

// 8. allow the sanctioned address, then confirm it STAYS blocked
{
  const { status } = await signedPost("allow", { address: SANCTIONED, reason: "attempt to allowlist sanctioned" });
  const { json } = await get(`/api/shield/check?address=${SANCTIONED}&chain=ethereum`);
  ok(
    "check: sanctioned address stays blocked even when allowlisted",
    json.blocked === true && json.source === "sanctioned",
    `allow-post status ${status}; blocked=${json.blocked} source=${json.source}`,
  );
}

// 9. list + stats
{
  const list = await get(`/api/shield/list`);
  const stats = await get(`/api/shield/stats`);
  ok("list returns blocks[] + allows[]", Array.isArray(list.json.blocks) && Array.isArray(list.json.allows), `allows=${list.json.counts?.allows}`);
  ok("stats returns 7d/30d/90d windows + retention_days=90", stats.json.retention_days === 90 && !!stats.json.windows?.["90d"], `7d total=${stats.json.windows?.["7d"]?.total}`);
}

// 10. bad signature is rejected with the ERC-1271 hint
{
  const nonce = await getNonce();
  const r = await fetch(`${BASE}/api/shield/block`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner, address: RANDOM, signature: "0x" + "00".repeat(65) }),
  });
  const j = await r.json();
  ok("bad signature -> 401 naming ERC-1271/Safe", r.status === 401 && /ERC-1271|Safe/i.test(j.detail || ""), `status ${r.status}`);
}

// cleanup: drop the throwaway owner's rows so we don't leave test state
await sql`DELETE FROM shield_blocks   WHERE owner = ${owner}`;
await sql`DELETE FROM shield_allows   WHERE owner = ${owner}`;
await sql`DELETE FROM shield_events   WHERE owner = ${owner}`;
await sql`DELETE FROM shield_nonces   WHERE owner = ${owner}`;
await sql`DELETE FROM shield_sessions WHERE owner = ${owner}`;
console.log("\ncleaned up test owner rows.");
