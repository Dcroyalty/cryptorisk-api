// scripts/self-pay.mjs
// Makes ONE real x402 payment to a paid endpoint so the settle path is exercised
// end-to-end (facilitator verify -> on-chain settle -> receipt). Required to
// confirm a v2 migration works: a 402 challenge alone does NOT prove settlement.
//
// SPENDS REAL MONEY — the endpoint's real price in USDC on Base. Exact scheme
// uses EIP-3009 transferWithAuthorization, so the facilitator submits the tx and
// pays gas: the payer wallet needs USDC only, no ETH, no token approval.
//
// The payer address MUST NOT be the PAY_TO address (a self-transfer moves no
// value, proves nothing, and facilitators commonly reject it). Use a fresh
// throwaway wallet funded with a little USDC on Base (>= the price; ~0.02-0.05
// for retries).
//
//   SELF_PAY_PRIVATE_KEY=0x... node scripts/self-pay.mjs
//   SELF_PAY_PRIVATE_KEY=0x... TARGET_URL="https://uxus.finance/api/risk/live/pro?address=0x0000000000000000000000000000000000000000" node scripts/self-pay.mjs
//   SELF_PAY_PRIVATE_KEY=0x... TARGET_URL="https://uxus.finance/api/llm" TARGET_METHOD=POST TARGET_BODY='{"prompt":"hi"}' node scripts/self-pay.mjs
//
// The private key is read from the environment ONLY. Never commit it (.env* is gitignored).
import { createSigner } from "x402/types";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";

const PK = process.env.SELF_PAY_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error("Set SELF_PAY_PRIVATE_KEY to a 0x-prefixed 32-byte hex private key.");
  process.exit(1);
}

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const TARGET =
  process.env.TARGET_URL ||
  "https://uxus.finance/api/risk/live/pro?address=0x0000000000000000000000000000000000000000";
const METHOD = (process.env.TARGET_METHOD || "GET").toUpperCase();
const BODY = process.env.TARGET_BODY || null;

function call(extra = {}) {
  const init = { method: METHOD, headers: { ...extra } };
  if (BODY != null) {
    init.headers["content-type"] = "application/json";
    init.body = BODY;
  }
  return fetch(TARGET, init);
}
function decodeB64Json(s) {
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
  console.error("Payer is the PAY_TO address. Use a different wallet — a self-transfer proves nothing.");
  process.exit(1);
}

const unpaid = await call();
console.log(`unpaid  -> ${unpaid.status}`);
if (unpaid.status !== 402) {
  console.log(await unpaid.text());
  console.error("\nExpected 402. Endpoint is not gated, or the request was malformed.");
  process.exit(1);
}

// v2 puts the challenge in the PAYMENT-REQUIRED header; the body echo is a mirror.
const challenge =
  decodeB64Json(unpaid.headers.get("payment-required")) ||
  (await unpaid.clone().json().catch(() => null));
const version = challenge?.x402Version ?? 1;
const accepts = challenge?.accepts ?? [];
const requirements = selectPaymentRequirements(accepts, "base", "exact");
if (!requirements) {
  console.error("No exact/base requirement in challenge:", JSON.stringify(challenge, null, 2));
  process.exit(1);
}
console.log(
  `challenge: x402Version ${version}, ` +
    `${requirements.maxAmountRequired ?? requirements.amount} atomic ` +
    `${requirements.extra?.name ?? "USDC"} -> ${requirements.payTo} (${requirements.network})\n`,
);

const paymentHeader = await createPaymentHeader(signer, version, requirements);
const paid = await call({ "X-PAYMENT": paymentHeader });
console.log(`paid    -> ${paid.status}`);

const settlement = decodeB64Json(paid.headers.get("x-payment-response"));
if (settlement) {
  console.log("settlement:", JSON.stringify(settlement, null, 2));
  if (settlement.transaction) console.log(`tx: https://basescan.org/tx/${settlement.transaction}`);
}
const text = await paid.text();
console.log("\nresponse body:");
console.log(text.length > 2000 ? text.slice(0, 2000) + "\n...[truncated]" : text);

if (paid.status !== 200) {
  console.error("\nFAIL: paid request did not return 200.");
  process.exit(1);
}
if (!settlement || settlement.success === false) {
  console.error("\nFAIL: no successful settlement receipt.");
  process.exit(1);
}
console.log("\nPASS: settled. Wait ~1 min, then: node scripts/bazaar-check.mjs");
