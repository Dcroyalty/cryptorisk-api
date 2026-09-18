// lib/search-core.ts — the web-search provider chain, shared by the paid
// /api/search route and the free MCP search_web tool.
// Providers tried in order: Serper (2,500/mo free) -> Brave (free tier) ->
// DuckDuckGo (keyless, unlimited). Works with no keys at all via DDG.
//
// Serper is the only provider with structured Google-SERP blocks (ads, People
// Also Ask, related searches, knowledge graph, shopping, AI Overview) — see
// lib/serper-map.ts. When Serper isn't used (no key, or it fails and we fall
// back to Brave/DDG) those fields come back empty/null rather than fabricated;
// `provider` always says which backend actually answered.

import { mapSerperResponse, type SerperMapped } from "@/lib/serper-map";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface SearchHit {
  title: string;
  url: string;
  description: string;
  score: number;
}

const EMPTY_SERPER_BLOCKS: SerperMapped = {
  organic: [],
  ads: [],
  people_also_ask: [],
  related_searches: [],
  knowledge_graph: null,
  answer_box: null,
  shopping: [],
  ai_overview: null,
};

export interface SearchResult {
  query: string;
  results: SearchHit[];
  // Structured Google-SERP blocks. Populated only when `provider` is "serper"
  // — Brave and DuckDuckGo don't expose these, so they come back empty/null,
  // never guessed.
  ads: unknown[];
  people_also_ask: SerperMapped["people_also_ask"];
  related_searches: string[];
  knowledge_graph: SerperMapped["knowledge_graph"];
  answer_box: SerperMapped["answer_box"];
  shopping: SerperMapped["shopping"];
  ai_overview: unknown | null;
  provider: "serper" | "brave" | "duckduckgo";
  latency_ms: number;
  served_by: string;
}

export interface SearchOptions {
  /** Serper `gl` / Brave `country` — 2-letter country code. */
  country?: string;
  /** Serper `hl` / Brave `search_lang` — 2+ letter language code. */
  language?: string;
  /** 1-based result page. Serper: passed through as `page`. Brave: converted to its 0-based `offset` (capped at 9 by Brave's own API). Ignored by DuckDuckGo (single-page HTML scrape, no pagination support). */
  page?: number;
  /**
   * Forwarded to Serper as-is if set. Serper's public documentation does not
   * confirm a stable device-targeting parameter as of 2026-09 (checked
   * against three independently maintained client implementations, none of
   * which implement one) — included for forward-compatibility, not because
   * it's verified to change results. Ignored by Brave and DuckDuckGo.
   */
  device?: string;
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

export async function searchWeb(qRaw: string, countRaw: number, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = (qRaw || "").trim();
  if (!q) throw new SearchError("query is required");
  const count = Math.min(Math.max(Number(countRaw) || 10, 1), 20);
  const started = Date.now();
  const serper = process.env.SERPER_API_KEY;
  const brave = process.env.BRAVE_API_KEY;

  if (serper) {
    try {
      const body: Record<string, unknown> = { q, num: count };
      if (opts.country) body.gl = opts.country;
      if (opts.language) body.hl = opts.language;
      if (opts.page) body.page = opts.page;
      if (opts.device) body.device = opts.device;

      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serper, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const d = await r.json();
        const mapped = mapSerperResponse(d);
        if (mapped.organic.length)
          return {
            query: q,
            results: withScores(mapped.organic.map((o) => ({ title: o.title, url: o.url, description: o.description }))),
            ads: mapped.ads,
            people_also_ask: mapped.people_also_ask,
            related_searches: mapped.related_searches,
            knowledge_graph: mapped.knowledge_graph,
            answer_box: mapped.answer_box,
            shopping: mapped.shopping,
            ai_overview: mapped.ai_overview,
            provider: "serper",
            latency_ms: Date.now() - started,
            served_by: "x402-search-gateway",
          };
      }
    } catch {}
  }

  if (brave) {
    try {
      const params = new URLSearchParams({ q, count: String(count) });
      if (opts.country) params.set("country", opts.country);
      if (opts.language) params.set("search_lang", opts.language);
      if (opts.page) params.set("offset", String(Math.max(0, Math.min(9, opts.page - 1))));

      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": brave },
      });
      if (r.ok) {
        const d = await r.json();
        const results = (d?.web?.results ?? []).map((x: Record<string, string>) => ({
          title: x.title,
          url: x.url,
          description: x.description,
        }));
        if (results.length)
          return {
            query: q,
            results: withScores(results),
            ...EMPTY_SERPER_BLOCKS,
            provider: "brave",
            latency_ms: Date.now() - started,
            served_by: "x402-search-gateway",
          };
      }
    } catch {}
  }

  const results = await ddg(q, count).catch(() => null);
  if (results)
    return {
      query: q,
      results: withScores(results),
      ...EMPTY_SERPER_BLOCKS,
      provider: "duckduckgo",
      latency_ms: Date.now() - started,
      served_by: "x402-search-gateway",
    };

  throw new SearchError("no provider returned results");
}
