// app/api/entity/route.ts — entity attribution. FREE. Not in the middleware matcher.
// GET /api/entity?address=0x...&chain=base|ethereum  (default base)
// Answers "what IS this address" from curated + public label sources.
import { NextRequest, NextResponse } from "next/server";
import { isEvmAddress } from "@/lib/sources";
import { lookupEntity } from "@/lib/entity";

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

  const e = await lookupEntity(raw.toLowerCase(), chain);
  return NextResponse.json(
    { address: e.address, chain: e.chain, is_known: e.is_known, label: e.label, category: e.category },
    { status: 200, headers: { "Cache-Control": "public, max-age=300" } },
  );
}
