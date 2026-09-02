// app/api/risk/live/route.ts â€” CryptoRisk LIVE (mutable-risk scanner)
//
// The one question every other scanner refuses to answer.
// GoPlus / Honeypot.is / ApeSpace all ship the same disclaimer: "a token that
// isn't a honeypot now could become one in the future." They score the PAST.
// This scores the FUTURE: can the owner turn hostile on you while you HOLD?
//
// FREE tier   : verdict + score + time_to_rug  (teaser, drives upgrades)
// PAID (/pro?): full powers[] + controls{} via existing x402 gate
//
// Pure on-chain reads. No GoPlus in the hot path -> faster + no rate ceiling.

import { NextResponse } from "next/server";
import { analyzeLiveRisk, type Chain } from "@/lib/live-risk";
import { isEvmAddress } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") || "").trim();
  const chain = ((url.searchParams.get("chain") || "base").toLowerCase() as Chain);

  if (!address || !isEvmAddress(address)) {
    return NextResponse.json(
      { error: "bad_request", message: "Provide ?address=0x... (EVM address)." },
      { status: 400 }
    );
  }
  if (chain !== "base" && chain !== "ethereum") {
    return NextResponse.json(
      { error: "bad_request", message: "chain must be 'base' or 'ethereum'." },
      { status: 400 }
    );
  }

  try {
    const r = await analyzeLiveRisk(address, chain);
    return NextResponse.json(
      {
        address: r.address,
        chain: r.chain,
        symbol: r.symbol,
        // --- the differentiator ---
        mutable_risk_score: r.mutable_risk_score,
        can_turn_hostile: r.can_turn_hostile,
        time_to_rug: r.time_to_rug,
        verdict: r.verdict,
        powers_count: r.powers.length,
        tier: "free",
        upgrade:
          "GET /api/risk/live/pro for the full powers[] + controls{} breakdown ($0.01/call via x402).",
        note:
          "Snapshot scanners tell you if a token is safe now. This tells you whether the owner can make it unsafe in the next block.",
        rpc_ok: r.rpc_ok,
        latency_ms: r.latency_ms,
        checked_at: r.checked_at,
      },
      { headers: { "Cache-Control": "public, max-age=15" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "analysis failed";
    return NextResponse.json({ error: "analysis_failed", message }, { status: 500 });
  }
}
