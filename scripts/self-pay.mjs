// scripts/self-pay.mjs
// Makes ONE real x402 v2 payment to a paid endpoint so the settle path is
// exercised end-to-end (facilitator verify -> on-chain settle -> receipt).
// A 402 challenge alone does NOT prove settlement.
//
// v2 ONLY. Imports @x402/core + @x402/evm exclusively. Never import x402/types
// or x402/client (v1) here — mixing v1 and v2 x402 packages in one process
// produces "'paymentPayload' is invalid: must match one of [x402V2PaymentPayload,
// x402V1PaymentPayload]" at the CDP facilitator.
//
// SPENDS REAL MONEY — the endpoint's real price in USDC on Base. Exact scheme
// uses EIP-3009 transferWithAuthorization: the facilitator submits the tx and
// pays gas, so the payer wallet needs USDC only (>= the price; ~0.02-0.05 for
// retries), no ETH, no token approval.
//
// The payer address MUST NOT be the PAY_TO address.
//
//   SELF_PAY_PRIVATE_KEY=0x... node scripts/self-pay.mjs
//   SELF_PAY_PRIVATE_KEY=0x... TARGET_URL="https://uxus.finance/api/risk/bazaar?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=ethereum" node scripts/self-pay.mjs
//   SELF_PAY_PRIVATE_KEY=0x... TARGET_URL="https://uxus.finance/api/llm" TARGET_METHOD=POST TARGET_BODY='{"prompt":"hi"}' node scripts/self-pay.mjs
//
// Key is read from the environment ONLY. Never commit it (.env* is gitignored).
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const PK = process.env.SELF_PAY_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error("Set SELF_PAY_PRIVATE_KEY to a 0x-prefixed 32-byte hex private key.");
  process.exit(1);
}

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const TARGET =
  process.env.TARGET_URL ||
  "https://uxus.finance/api/risk/bazaar?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=ethereum";
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
function decodeMaybeB64Json(s) {
  if (!s || typeof s !== "string") return s ?? null;
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
}

const account = privateKeyToAccount(PK);
if (account.address.toLowerCase() === PAY_TO.toLowerCase()) {
  console.error("Payer is the PAY_TO address. Use a different wallet — a self-transfer proves nothing.");
  process.exit(1);
}

const core = new x402Client();
registerExactEvmScheme(core, { signer: account, networks: ["eip155:8453"] });
const http = new x402HTTPClient(core);

console.log(`payer:  ${account.address}`);
console.log(`target: ${METHOD} ${TARGET}\n`);

// 1 — unpaid request, expect a v2 402 challenge.
const unpaid = await call();
console.log(`unpaid  -> ${unpaid.status}`);
if (unpaid.status !== 402) {
  console.log(await unpaid.text());
  console.error("\nExpected 402.");
  process.exit(1);
}
let parsedBody;
try {
  parsedBody = JSON.parse(await unpaid.clone().text());
} catch {
  parsedBody = undefined;
}
const paymentRequired = http.getPaymentRequiredResponse(
  (name) => unpaid.headers.get(name),
  parsedBody,
);
const accepts = paymentRequired.accepts ?? [];
console.log(
  `challenge: x402Version ${paymentRequired.x402Version}, ` +
    accepts.map((a) => `${a.amount ?? a.maxAmountRequired} atomic @ ${a.network}`).join(", ") +
    "\n",
);

// 2 — build + sign the payment payload (offline EIP-712), encode as an HTTP header.
const payload = await http.createPaymentPayload(paymentRequired);
const payHeaders = http.encodePaymentSignatureHeader(payload);
console.log("payload (decoded object):");
console.log(JSON.stringify(payload, null, 2));
console.log(`\nheader name(s) sent: ${Object.keys(payHeaders).join(", ")}`);
for (const [k, v] of Object.entries(payHeaders)) {
  const dec = decodeMaybeB64Json(v);
  if (dec && typeof dec === "object") console.log(`  ${k} decodes to:`, JSON.stringify(dec));
}
console.log();

// 3 — retry with payment; facilitator verifies + settles on-chain, returns the result.
const paid = await call(payHeaders);
console.log(`paid    -> ${paid.status}`);

let settlement = null;
try {
  settlement = http.getPaymentSettleResponse((name) => paid.headers.get(name));
} catch {
  settlement = null;
}
if (settlement) {
  console.log("settlement:", JSON.stringify(settlement, null, 2));
  if (settlement.transaction) console.log(`tx: https://basescan.org/tx/${settlement.transaction}`);
}
const text = await paid.text();
console.log("\nresponse body:");
console.log(text.length > 3000 ? text.slice(0, 3000) + "\n...[truncated]" : text);

if (paid.status !== 200) {
  console.error("\nFAIL: paid request did not return 200.");
  process.exit(1);
}
if (!settlement || settlement.success === false) {
  console.error("\nFAIL: no successful settlement receipt.");
  process.exit(1);
}
console.log("\nPASS: settled. Wait ~1 min, then: node scripts/bazaar-check.mjs");
