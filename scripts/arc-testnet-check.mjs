// scripts/arc-testnet-check.mjs
// Smoke-tests the two external calls the Arc integration depends on —
// Circle's Arc RPC (eth_getCode / eth_call, the live-risk.ts contract-read
// path) and the Blockscout explorer (txlist, the sources.ts wallet-history
// path) — against Arc TESTNET, since mainnet URLs don't exist yet.
//
// Defaults match lib/arc.ts's testnet fallbacks. Once Circle publishes
// mainnet values, re-run with:
//   ARC_RPC_URL=<mainnet rpc> ARC_EXPLORER_URL=<mainnet explorer> node scripts/arc-testnet-check.mjs
//
//   node scripts/arc-testnet-check.mjs

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const EXPLORER_URL = process.env.ARC_EXPLORER_URL || "https://testnet.arcscan.app";
// A real address with tx history on Arc testnet (found via a live txlist probe).
const TEST_ADDR = "0x91681c0eb131fb3098ff5077d9a6c63ffe8c27ac";

async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

console.log(`RPC:      ${RPC_URL}`);
console.log(`Explorer: ${EXPLORER_URL}\n`);

console.log("=== eth_chainId ===");
const chainIdHex = await rpc("eth_chainId", []);
console.log(`chainId: ${chainIdHex} (${parseInt(chainIdHex, 16)})`);

console.log("\n=== eth_getCode (live-risk.ts contract-analysis path) ===");
const code = await rpc("eth_getCode", [TEST_ADDR, "latest"]);
console.log(`is_contract: ${code !== "0x" && code.length > 4}`);

console.log("\n=== Blockscout txlist (sources.ts wallet-history path) ===");
const res = await fetch(
  `${EXPLORER_URL}/api?module=account&action=txlist&address=${TEST_ADDR}&sort=asc&page=1&offset=10000`,
);
const body = await res.json();
const ok = Array.isArray(body.result);
console.log(`status ${res.status}, result is array: ${ok}, tx count: ${ok ? body.result.length : "n/a"}`);

if (!ok) {
  console.error("\nFAILED — Blockscout did not return a usable result. Check EXPLORER_URL.");
  process.exit(1);
}
console.log("\nAll checks passed.");
