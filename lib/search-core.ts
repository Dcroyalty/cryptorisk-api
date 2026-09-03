// lib/search-core.ts — the web-search provider chain, shared by the paid
// /api/search route and the free MCP search_web tool.
// Providers tried in order: Serper (2,500/mo free) -> Brave (free tier) ->
// DuckDuckGo (keyless, unlimited). Works with no keys at all via DDG.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface SearchHit {
  title: string;
  url: string;
  description: string;
  score: number;
}
export interface SearchResult {
  query: string;
  results: SearchHit[];
  provider: "serper" | "brave" | "duckduckgo";
  latency_ms: number;
  served_by: string;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function strip(s: string): string {
  return decode(s.replace(/<[^>]+>/g, "")).replace(/\s{2,}/g, " ").trim();
}

// Normalize provider rank to a 0-1 descending score: rank 1 of N -> 1.0, rank N -> 1/N.
function withScores(results: { title: string; url: string; description: string }[]): SearchHit[] {
  const n = results.length || 1;
  return results.map((r, i) => ({ ...r, score: Math.round(((n - i) / n) * 1000) / 1000 }));
}

async function ddg(q: string, count: number) {
  const r = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q }).toString(),
  });
  if (!r.ok) return null;
  const html = await r.text();
  const results: { title: string; url: string; description: string }[] = [];
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < count) {
    let url = decode(m[1]);
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1]);
      } catch {}
    }
    results.push({ title: strip(m[2]), url, description: strip(m[3]) });
  }
  return results.length ? results : null;
}

export class SearchError extends Error {}

export async function searchWeb(qRaw: string, countRaw: number): Promise<SearchResult> {
  const q = (qRaw || "").trim();
  if (!q) throw new SearchError("query is required");
  const count = Math.min(Math.max(Number(countRaw) || 10, 1), 20);
  const started = Date.now();
  const serper = process.env.SERPER_API_KEY;
  const brave = process.env.BRAVE_API_KEY;

  if (serper) {
    try {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serper, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num: count }),
      });
      if (r.ok) {
        const d = await r.json();
        const results = (d?.organic ?? []).map((x: Record<string, string>) => ({
          title: x.title,
          url: x.link,
          description: x.snippet,
        }));
        if (results.length)
          return { query: q, results: withScores(results), provider: "serper", latency_ms: Date.now() - started, served_by: "x402-search-gateway" };
      }
    } catch {}
  }

  if (brave) {
    try {
      const r = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`,
        { headers: { Accept: "application/json", "X-Subscription-Token": brave } },
      );
      if (r.ok) {
        const d = await r.json();
        const results = (d?.web?.results ?? []).map((x: Record<string, string>) => ({
          title: x.title,
          url: x.url,
          description: x.description,
        }));
        if (results.length)
          return { query: q, results: withScores(results), provider: "brave", latency_ms: Date.now() - started, served_by: "x402-search-gateway" };
      }
    } catch {}
  }

  const results = await ddg(q, count).catch(() => null);
  if (results)
    return { query: q, results: withScores(results), provider: "duckduckgo", latency_ms: Date.now() - started, served_by: "x402-search-gateway" };

  throw new SearchError("no provider returned results");
}
