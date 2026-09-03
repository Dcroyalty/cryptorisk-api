// app/api/search/route.ts — x402 Search Gateway. $0.01 USDC/call on Base.
// Provider chain + scoring live in lib/search-core.ts (shared with the free MCP tool).
import { NextRequest, NextResponse } from "next/server";
import { searchWeb, SearchError } from "@/lib/search-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const count = Number(searchParams.get("count")) || 10;

  if (!q) {
    return NextResponse.json(
      { service: "x402 Search Gateway", usage: "GET /api/search?q=your+query&count=10", price: "$0.01 USDC on Base per call" },
      { status: 400 },
    );
  }

  try {
    const out = await searchWeb(q, count);
    return NextResponse.json(out, { status: 200 });
  } catch (e) {
    if (e instanceof SearchError) {
      return NextResponse.json({ error: "search_failed", detail: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: "search_failed", detail: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}
