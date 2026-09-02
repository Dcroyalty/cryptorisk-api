// scripts/self-pay-v1.mjs
// Tests whether an x402 PROTOCOL v1 payment actually SETTLES through the CDP
// facilitator on a production route. All 7 paid routes are v1 (x402-next
// middleware) right now — nobody has confirmed a v1 payment can settle.
//
// v1 ONLY. Imports x402/types and x402/client — the exact packages x402-next@1.2.0
// depends on (transitively x402@1.2.0). NO @x402/* imports. Sends X-PAYMENT
// (the v1 header), never PAYMENT-SIGNATURE (v2).
//
// SPENDS REAL MONEY: /api/risk/pro is $0.01 USDC on Base. Exact scheme uses
// EIP-3009 transferWithAuthorization — the facilitator submits the tx and pays
// gas, so the wallet needs USDC only (>= $0.01), no ETH, no token approval.
//
//   node scripts/self-pay-v1.mjs
//   (reads SELF_PAY_PRIVATE_KEY from the environment or from .env)
//
// The private key is read from the environment / .env ONLY. Never commit it
// (.env is gitignored).
import { readFileSync } from "node:fs";
import { createSigner } from "x402/types";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";

// minimal .env loader — no dependency, does not overwrite real env vars
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PK =
  process.env.SELF_PAY_PRIVATE_KEY || process.env.BURNER_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error("Set SELF_PAY_PRIVATE_KEY (0x + 64 hex) in the environment or .env");
  process.exit(1);
}

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const TARGET =
  process.env.TARGET_URL ||
  "https://uxus.finance/api/risk/pro?address=0x0000000000000000000000000000000000000000";
const METHOD = (process.env.TARGET_METHOD || "GET").toUpperCase();
const BODY = process.env.TARGET_BODY || null; // JSON string for POST routes

function req(extraHeaders = {}) {
  const init = { method: METHOD, headers: { ...extraHeaders } };
  if (BODY != null) {
    init.headers["content-type"] = "application/json";
    init.body = BODY;
  }
  return fetch(TARGET, init);
}

function b64json(s) {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch {
    return s;
  }
}

const signer = await createSigner("base", PK);
const payer = signer.account?.address ?? signer.address;
console.log(`payer:  ${payer}`);
console.log(`target: ${METHOD} ${TARGET}\n`);
if (payer && payer.toLowerCase() === PAY_TO.toLowerCase()) {
  console.error("Payer is the PAY_TO address — use a different wallet.");
  process.exit(1);
}

// 1 — unpaid request. A v1 challenge lives in the JSON BODY (no PAYMENT-REQUIRED header).
const unpaid = await req();
console.log(`unpaid  -> ${unpaid.status}`);
if (unpaid.status !== 402) {
  console.log(await unpaid.text());
  console.error("\nExpected 402.");
  process.exit(1);
}
console.log(`  PAYMENT-REQUIRED header present: ${unpaid.headers.get("payment-required") ? "yes" : "no"}`);
const challenge = await unpaid.json();
const accepts = challenge.accepts ?? [];
console.log(
  `challenge: x402Version ${challenge.x402Version}, ` +
    accepts.map((a) => `${a.maxAmountRequired ?? a.amount} @ ${a.network}`).join(", "),
);
if (challenge.x402Version !== 1) {
  console.log(`  NOTE: expected a v1 body challenge; got x402Version ${challenge.x402Version}`);
}

const requirements = selectPaymentRequirements(accepts, "base", "exact");
if (!requirements) {
  console.error("No exact/base requirement:", JSON.stringify(challenge, null, 2));
  process.exit(1);
}

// 2 — build + sign the v1 payment header (offline EIP-712 transferWithAuthorization).
const header = await createPaymentHeader(signer, challenge.x402Version ?? 1, requirements);
console.log(`\nX-PAYMENT header built (${header.length} chars)`);
const decoded = b64json(header);
if (decoded && typeof decoded === "object") {
  console.log("payload:", JSON.stringify(decoded));
}

// 3 — retry with X-PAYMENT. The middleware verifies + settles via the CDP facilitator.
const paid = await req({ "X-PAYMENT": header });
console.log(`\npaid    -> ${paid.status}`);

const settlement = b64json(
  paid.headers.get("x-payment-response") || paid.headers.get("payment-response"),
);
if (settlement) {
  console.log("settlement receipt:", JSON.stringify(settlement, null, 2));
  if (settlement.transaction) console.log(`\nbasescan: https://basescan.org/tx/${settlement.transaction}`);
}
const body = await paid.text();
console.log("\nresponse body:", body.length > 1500 ? body.slice(0, 1500) + "\n...[truncated]" : body);

if (paid.status === 200 && settlement && settlement.success !== false) {
  console.log("\n=== PASS: v1 payment SETTLED. The store can take money. ===");
  process.exit(0);
}
console.log("\n=== FAIL: v1 payment did NOT settle. ===");
process.exit(1);
