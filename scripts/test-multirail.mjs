// scripts/test-multirail.mjs — prove a REAL x402 v2 payment on one rail lands
// and delivers, against production, before the multi-rail flag is turned on.
//
//   node scripts/test-multirail.mjs polygon     # pays from SELF_PAY_PRIVATE_KEY (EVM)
//   node scripts/test-multirail.mjs solana      # pays from SOLANA_TEST_PAYER_SECRET
//   node scripts/test-multirail.mjs base
//
// Reads .env (SELF_PAY_PRIVATE_KEY, SOLANA_TEST_PAYER_SECRET, X402_MULTIRAIL_TEST_TOKEN).
// Spends exactly $0.01 USDC per run. Pass: HTTP 200 + product body + a
// PAYMENT-RESPONSE settlement header + the USDC visible at payTo on-chain.
import fs from "node:fs";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const BASE_URL = process.env.BASE_URL || "https://uxus.finance";
const URL_PATH = process.env.TEST_PATH || "/api/v2/risk/pro?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const NETWORKS = {
  base: "eip155:8453",
  polygon: "eip155:137",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const rail = process.argv[2];
const network = NETWORKS[rail];
if (!network) throw new Error(`usage: node scripts/test-multirail.mjs ${Object.keys(NETWORKS).join("|")}`);
const token = process.env.X402_MULTIRAIL_TEST_TOKEN || env.X402_MULTIRAIL_TEST_TOKEN;
if (!token) throw new Error("X402_MULTIRAIL_TEST_TOKEN missing");

// Force the rail under test.
const client = new x402Client((_version, accepts) => {
  const pick = accepts.find((a) => a.network === network);
  if (!pick) throw new Error(`the 402 does not offer ${network}; offered: ${accepts.map((a) => a.network).join(", ")}`);
  return pick;
});
if (rail === "solana") {
  const secret = Buffer.from(env.SOLANA_TEST_PAYER_SECRET, "base64");
  registerExactSvmScheme(client, { signer: await createKeyPairSignerFromBytes(new Uint8Array(secret)) });
} else {
  registerExactEvmScheme(client, { signer: privateKeyToAccount(env.SELF_PAY_PRIVATE_KEY) });
}
const http = new x402HTTPClient(client);
const headers = { accept: "application/json", "x-uxus-rail-test": token };

// 1) challenge
const first = await fetch(BASE_URL + URL_PATH, { headers, redirect: "manual" });
if (first.status !== 402) {
  console.log(`FAIL: expected 402, got ${first.status} ${first.headers.get("location") ?? ""} ${first.headers.get("x-uxus-rail") ?? ""}`);
  console.log((await first.text()).slice(0, 500));
  process.exit(1);
}
const body402 = await first.json().catch(() => undefined);
const required = http.getPaymentRequiredResponse((n) => first.headers.get(n), body402);
console.log(`402 offers: ${required.accepts.map((a) => `${a.network} -> ${a.payTo} (${a.amount})`).join(" | ")}`);
const offer = required.accepts.find((a) => a.network === network);

// 2) pay
const payload = await http.createPaymentPayload(required);
const paid = await fetch(BASE_URL + URL_PATH, { headers: { ...headers, ...http.encodePaymentSignatureHeader(payload) }, redirect: "manual" });
const text = await paid.text();
let settle = null;
try {
  settle = http.getPaymentSettleResponse((n) => paid.headers.get(n));
} catch {
  /* no settlement header */
}
console.log(`paid request -> HTTP ${paid.status}; x-uxus-rail: ${paid.headers.get("x-uxus-rail")}`);
console.log(`settlement: ${JSON.stringify(settle)}`);
console.log(`body: ${text.slice(0, 300)}`);
const delivered = paid.status === 200 && settle?.success && settle?.transaction;
if (!delivered) {
  console.log("FAIL: not delivered + settled");
  process.exit(1);
}

// 3) independent on-chain check that the USDC reached payTo
async function onChain() {
  if (rail === "solana") {
    const r = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [settle.transaction, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
    }).then((x) => x.json());
    const post = r.result?.meta?.postTokenBalances ?? [];
    const pre = r.result?.meta?.preTokenBalances ?? [];
    const mine = (arr) => Number(arr.find((b) => b.owner === offer.payTo && b.mint === offer.asset)?.uiTokenAmount?.amount ?? 0);
    return { ok: r.result?.meta?.err === null, received: (mine(post) - mine(pre)) / 1e6 };
  }
  const rpcUrl = rail === "polygon" ? "https://polygon-bor-rpc.publicnode.com" : "https://mainnet.base.org";
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [settle.transaction] }),
  }).then((x) => x.json());
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const to = "0x" + offer.payTo.toLowerCase().slice(2).padStart(64, "0");
  const log = (r.result?.logs ?? []).find((l) => l.address.toLowerCase() === offer.asset.toLowerCase() && l.topics[0] === topic && l.topics[2] === to);
  return { ok: r.result?.status === "0x1", received: log ? Number(BigInt(log.data)) / 1e6 : 0 };
}
let chain = { ok: false, received: 0 };
for (let i = 0; i < 10 && !(chain.ok && chain.received > 0); i++) {
  chain = await onChain().catch(() => chain);
  if (!(chain.ok && chain.received > 0)) await new Promise((r) => setTimeout(r, 3000));
}
console.log(`on-chain: tx ${settle.transaction} success=${chain.ok} payTo received ${chain.received} USDC`);
console.log(chain.ok && chain.received >= 0.01 ? `PASS ${rail}` : `FAIL ${rail}: settlement not confirmed on-chain`);
process.exit(chain.ok && chain.received >= 0.01 ? 0 : 1);
