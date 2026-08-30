// app/api/search/route.ts — x402 Search Gateway. $0.02 USDC/call on Base.
// Providers tried in order: Serper (2,500 free, no card) -> Brave -> DuckDuckGo (keyless, $0).
// Works with NO keys at all thanks to the DDG fallback.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function strip(s: string) { return decode(s.replace(/<[^>]+>/g, "")).replace(/\s{2,}/g, " ").trim(); }

async function ddg(q: string, count: number) {
  const r = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q }).toString(),
  });
  if (!r.ok) return null;
  const html = await r.text();
  const results: any[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < count) {
    let url = decode(m[1]);
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) { try { url = decodeURIComponent(uddg[1]); } catch {} }
    results.push({ title: strip(m[2]), url, description: strip(m[3]) });
  }
  return results.length ? results : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const count = Math.min(Number(searchParams.get("count")) || 10, 20);
  if (!q) return NextResponse.json({ service: "x402 Search Gateway",
    usage: "GET /api/search?q=your+query&count=10", price: "$0.02 USDC on Base per call" }, { status: 400 });

  const started = Date.now();
  const serper = process.env.SERPER_API_KEY;
  const brave = process.env.BRAVE_API_KEY;

  if (serper) {
    try {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": serper, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num: count }) });
      if (r.ok) {
        const d = await r.json();
        const results = (d?.organic ?? []).map((x: any) => ({ title: x.title, url: x.link, description: x.snippet }));
        if (results.length) return NextResponse.json({ query: q, results, provider: "serper",
          latency_ms: Date.now() - started, served_by: "x402-search-gateway" }, { status: 200 });
      }
    } catch {}
  }

  if (brave) {
    try {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`,
        { headers: { "Accept": "application/json", "X-Subscription-Token": brave } });
      if (r.ok) {
        const d = await r.json();
        const results = (d?.web?.results ?? []).map((x: any) => ({ title: x.title, url: x.url, description: x.description }));
        if (results.length) return NextResponse.json({ query: q, results, provider: "brave",
          latency_ms: Date.now() - started, served_by: "x402-search-gateway" }, { status: 200 });
      }
    } catch {}
  }

  try {
    const results = await ddg(q, count);
    if (results) return NextResponse.json({ query: q, results, provider: "duckduckgo",
      latency_ms: Date.now() - started, served_by: "x402-search-gateway" }, { status: 200 });
  } catch {}

  return NextResponse.json({ error: "search_failed", detail: "No provider returned results." }, { status: 502 });
}
