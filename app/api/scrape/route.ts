// app/api/scrape/route.ts — x402 Scrape Gateway. $0.01 USDC/call on Base.
// Fetch + extraction live in lib/scrape-core.ts (shared with the free MCP tool).
import { NextRequest, NextResponse } from "next/server";
import { scrapeUrl, ScrapeError } from "@/lib/scrape-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const target = (searchParams.get("url") || "").trim();
  const format = searchParams.get("format") || "markdown";
  const maxChars = Number(searchParams.get("max_chars")) || 40000;

  if (!target) {
    return NextResponse.json(
      {
        service: "x402 Scrape Gateway",
        usage: "GET /api/scrape?url=https://example.com&format=markdown|text|html&max_chars=40000",
        price: "$0.01 USDC on Base per call",
      },
      { status: 400 },
    );
  }

  try {
    const out = await scrapeUrl(target, format, maxChars);
    return NextResponse.json(out, { status: 200 });
  } catch (e) {
    if (e instanceof ScrapeError) {
      return NextResponse.json({ error: e.code, detail: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "scrape_failed", detail: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}
