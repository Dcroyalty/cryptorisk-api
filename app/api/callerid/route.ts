// app/api/callerid/route.ts — "should this wallet be answered." FREE.
// Wallet messaging (XMTP, Push) has no spam filter. This composes what we
// already have — entity attribution, risk score, on-chain history, verified
// name — into one recommendation with the reasoning. Not in the middleware matcher.
import { NextRequest, NextResponse } from "next/server";
import { isEvmAddress } from "@/lib/sources";
import { composeCallerId } from "@/lib/callerid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("address") || "").trim();
  const chain = (searchParams.get("chain") || "base").toLowerCase();

  if (!isEvmAddress(raw)) {
    return NextResponse.json(
      { error: "invalid_address", detail: "Provide a valid 0x EVM address." },
      { status: 400 },
    );
  }
  if (chain !== "base" && chain !== "ethereum") {
    return NextResponse.json(
      { error: "unsupported_chain", detail: "chain must be 'base' or 'ethereum'." },
      { status: 400 },
    );
  }
  const addr = raw.toLowerCase();

  const { entity, risk, name, exists, result } = await composeCallerId(addr, chain as "base" | "ethereum");

  return NextResponse.json(
    {
      address: addr,
      chain,
      name,
      entity: entity ?? { is_known: false, label: null, category: "unknown" },
      exists,
      risk_score: risk ? risk.score : null,
      risk_level: risk ? risk.level : null,
      verdict: risk ? risk.verdict : null,
      recommendation: result.recommendation,
      confidence: result.confidence,
      reasons: result.reasons,
      checked_at: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "public, max-age=60" } },
  );
}
