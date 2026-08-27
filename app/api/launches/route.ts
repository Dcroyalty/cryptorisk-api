// app/api/launches/route.ts â€” CryptoRisk LAUNCHES (fresh token feed)
//
// The top-of-funnel magnet. Sniper bots poll this constantly for the newest DEX
// pools on Base/ETH the moment they appear. Every row cross-links to
// /api/risk/live so a bot goes "found a new pair" -> "can the owner rug me?" in
// two calls. Free data (GeckoTerminal public API, no key). This is the hook that
// drives high-frequency traffic to the PAID /api/risk/live/pro scanner.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NET: Record<string, string> = { base: "base", ethereum: "eth", eth: "eth" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainIn = (url.searchParams.get("chain") || "base").toLowerCase();
  const network = NET[chainIn];
  if (!network) {
    return NextResponse.json({ error: "bad_request", message: "chain must be 'base' or 'ethereum'." }, { status: 400 });
  }
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 30);
  const minLiq = Math.max(parseFloat(url.searchParams.get("minLiquidityUsd") || "0") || 0, 0);
  const canonical = chainIn === "eth" ? "ethereum" : chainIn;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return NextResponse.json({ error: "upstream_unavailable", status: r.status }, { status: 502 });

    const j = await r.json();
    const now = Date.now();

    type Pool = { attributes?: Record<string, unknown>; relationships?: Record<string, unknown> };
    const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

    const rows = ((j?.data ?? []) as Pool[]).map((p) => {
      const a = (p.attributes ?? {}) as Record<string, unknown>;
      const rel = (p.relationships ?? {}) as Record<string, unknown>;
      const baseTok = (((rel.base_token as Record<string, unknown>)?.data) as Record<string, unknown>)?.id as string | undefined;
      const dex = (((rel.dex as Record<string, unknown>)?.data) as Record<string, unknown>)?.id as string | undefined;
      const tokenAddress = baseTok && baseTok.includes("_") ? baseTok.split("_").slice(1).join("_") : baseTok ?? null;

      const liquidityUsd = num(a.reserve_in_usd);
      const vol24 = num((a.volume_usd as Record<string, unknown>)?.h24);
      const created = a.pool_created_at ? Date.parse(String(a.pool_created_at)) : now;
      const ageMinutes = Math.max(0, Math.round((now - created) / 60000));

      const flags: string[] = [];
      if (ageMinutes <= 15) flags.push("FRESH");
      if (liquidityUsd > 0 && liquidityUsd < 5000) flags.push("THIN_LIQUIDITY");
      if (liquidityUsd > 0 && vol24 > liquidityUsd * 3) flags.push("HIGH_CHURN");

      return {
        pair: (a.name as string) ?? null,
        tokenAddress,
        priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
        liquidityUsd,
        fdvUsd: a.fdv_usd ? Number(a.fdv_usd) : null,
        volumeH24Usd: vol24 || null,
        ageMinutes,
        flags,
        dex: dex ?? null,
        riskCheck: tokenAddress ? `/api/risk/live?address=${tokenAddress}&chain=${canonical}` : null,
      };
    }).filter((x) => x.liquidityUsd >= minLiq).slice(0, limit);

    return NextResponse.json(
      {
        chain: canonical,
        count: rows.length,
        launches: rows,
        note: "Newest DEX pools. Chain each riskCheck (/api/risk/live) to see if the owner can rug it before you ape.",
        source: "geckoterminal",
        checked_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, max-age=10" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: "launches_failed", message }, { status: 500 });
  }
}
