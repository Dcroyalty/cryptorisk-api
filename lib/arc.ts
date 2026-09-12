// lib/arc.ts — Circle's Arc L1: env-driven RPC/explorer config + mainnet gate.
//
// Defaults point at Arc TESTNET so the integration can be built and proven
// end-to-end before Circle publishes mainnet values. Cutover to mainnet is
// ARC_RPC_URL + ARC_EXPLORER_URL env vars and a redeploy — no code change,
// no PR. isArcMainnetLive() below is the only gate, and it flips itself the
// moment ARC_RPC_URL no longer points at the testnet default.
//
// Honest framing: TRM Labs and Elliptic are already Arc infrastructure
// partners. We are NOT the first blockchain intelligence on Arc — we're the
// first self-serve, no-sales-call risk API on it. Don't write "first" alone.

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
export const ARC_TESTNET_EXPLORER_URL = "https://testnet.arcscan.app";

export function arcRpcUrl(): string {
  return process.env.ARC_RPC_URL || ARC_TESTNET_RPC_URL;
}

export function arcExplorerUrl(): string {
  return process.env.ARC_EXPLORER_URL || ARC_TESTNET_EXPLORER_URL;
}

// Live = someone pointed ARC_RPC_URL at something other than the testnet
// default. That's the entire gate — set the env var, redeploy, done.
export function isArcMainnetLive(): boolean {
  return arcRpcUrl() !== ARC_TESTNET_RPC_URL;
}

export const ARC_NOT_LIVE_MESSAGE =
  "Arc support is built and verified against Arc testnet but gated until mainnet is live. Retry after launch.";
