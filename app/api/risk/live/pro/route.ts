// app/api/risk/live/pro/route.ts — CryptoRisk LIVE PRO ($0.005 via x402 v2)
// Gated by lib/x402.ts (@x402/core resource server + CDP facilitator).
// Returns the FULL mutable-risk breakdown: every owner power + raw controls.

import { NextRequest, NextResponse } from "next/server";
import { analyzeLiveRisk, type Chain } from "@/lib/live-risk";
import { isEvmAddress } from "@/lib/sources";
import { withX402 } from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLAIN: Record<string, string> = {
  OWNER_CAN_REPLACE_ALL_CONTRACT_LOGIC:
    "Upgradeable proxy: the admin can swap the implementation for hostile code in one transaction. Your sell path can be removed while you hold.",
  PROXY_ADMIN_ACTIVE: "A live (non-burned) proxy admin controls upgrades.",
  OWNER_RETAINS_PRIVILEGES:
    "Ownership is not renounced. Owner-only functions (fees, limits, blacklists) remain callable.",
  CURRENTLY_PAUSED_TRANSFERS_BLOCKED:
    "Transfers are paused RIGHT NOW. You may be unable to sell at this moment.",
  OWNER_CAN_PAUSE_ALL_TRANSFERS:
    "A pause function exists and is currently off. The owner can freeze all transfers at will.",
  OWNERSHIP_TRANSFER_PENDING:
    "A two-step ownership transfer is pending. Control may change hands imminently.",
  CONTROLS_LOCKED: "Ownership renounced and not upgradeable. The rules cannot change.",
  NOT_A_CONTRACT: "This address is a wallet (EOA), not a token contract.",
  RPC_UNAVAILABLE_RESULT_UNKNOWN:
    "Chain was unreachable. Treat as UNKNOWN, not safe. Retry before acting.",
};

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") || "").trim();
  const chain = ((url.searchParams.get("chain") || "base").toLowerCase() as Chain);

  if (!address || !isEvmAddress(address)) {
    return NextResponse.json({ error: "bad_request", message: "Provide ?address=0x..." }, { status: 400 });
  }
  if (chain !== "base" && chain !== "ethereum") {
    return NextResponse.json({ error: "bad_request", message: "chain must be 'base' or 'ethereum'." }, { status: 400 });
  }

  try {
    const r = await analyzeLiveRisk(address, chain);
    return NextResponse.json(
      {
        ...r,
        powers_explained: r.powers.map((p) => ({ code: p, meaning: EXPLAIN[p] ?? p })),
        tier: "pro",
        methodology:
          "Direct on-chain reads: eth_getCode, owner()/getOwner(), pendingOwner(), paused(), implementation(), and EIP-1967 proxy slots. No third-party security API - nothing to rate-limit or go stale.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "analysis failed";
    return NextResponse.json({ error: "analysis_failed", message }, { status: 500 });
  }
}

export const GET = withX402(
  {
    path: "/api/risk/live/pro",
    method: "GET",
    price: "$0.005",
    description:
      "Free /api/risk/live returns verdict, mutable_risk_score, time_to_rug. Paid adds every owner power with a plain-English explanation, the raw controls object (owner address, EIP-1967 implementation + admin slots, pause state, pending owner), and the on-chain reads to reproduce the score.",
    serviceName: "UXUS Agent Services",
    tags: ["risk", "security", "token", "rug", "base", "ethereum"],
  },
  handler,
);
