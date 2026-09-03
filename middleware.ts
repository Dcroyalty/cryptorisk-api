import { NextRequest, NextResponse } from "next/server";
import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const N = "base" as Network;

const inner = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": { price: "$0.01", network: N,
      config: { description: "Adds to the free /api/risk (score, level, verdict, flags): per-signal reasons with severity, the raw signals object (token buy/sell tax, mint/proxy/hidden-owner flags, or wallet age + tx count), and the source list behind every flag." } },
    "/api/risk/live/pro": { price: "$0.01", network: N,
      config: { description: "Adds to the free /api/risk/live (verdict, mutable_risk_score, time_to_rug): every owner power explained in plain English, the raw controls object (owner, EIP-1967 implementation + admin slots, pause state, pending owner), and the on-chain reads to reproduce the score." } },
    "/api/llm":      { price: "$0.01", network: N,
      config: { description: "Returns the completion text, the model that produced it (from a 5-model fallback chain), token usage, and latency_ms." } },
    "/api/scrape":   { price: "$0.01", network: N,
      config: {
        description: "Fetch any URL and get clean, LLM-ready page content — no API key, no account, no signup; pay per call in USDC on Base. Sends a real browser User-Agent to get past common bot-blocking. GET /api/scrape?url=https://... (required) with optional format=markdown|text|html (default markdown) and max_chars=N (default 40000, max 120000). Returns { url, status, title, description, format, content, truncated, chars, latency_ms }; non-HTML URLs come back as raw content. For agents that need to read an article, doc page, or listing as text before summarising or extracting from it.",
        inputSchema: {
          queryParams: {
            url: "Absolute URL to fetch. Required.",
            format: "markdown | text | html. Default markdown.",
            max_chars: "Truncation limit, default 40000, max 120000.",
          },
        },
        outputSchema: {
          type: "json",
          example: {
            url: "https://example.com/article",
            status: 200,
            title: "Example Article",
            description: "A one-line summary from the page's meta description.",
            format: "markdown",
            content: "# Example Article\n\nClean body text as markdown...",
            truncated: false,
            chars: 1840,
            latency_ms: 620,
          },
        },
      } },
    "/api/extract":  { price: "$0.01", network: N,
      config: { description: "Returns a JSON object populated to the schema you POST, extracted from your text or URL, plus the model that produced it." } },
    "/api/embed":    { price: "$0.01", network: N,
      config: { description: "Returns one 1024-dim jina-embeddings-v3 vector per input string (up to 64), with the dimension count and token usage." } },
    "/api/search":   { price: "$0.01", network: N,
      config: {
        description: "Live web search for AI agents — no API key, no account, no signup; pay per call in USDC on Base. GET /api/search?q=YOUR+QUERY (required) with optional count=N (1–20, default 10). Returns { query, results: [{ title, url, description }], provider, latency_ms }. Multiple search backends with automatic failover, so a transient upstream outage doesn't fail your call. Use it to ground an answer in current web data, check a fact, or gather source URLs to scrape.",
        inputSchema: {
          queryParams: {
            q: "Search query. Required.",
            count: "Number of results, 1-20. Default 10.",
          },
        },
        outputSchema: {
          type: "json",
          example: {
            query: "x402 payment protocol",
            results: [
              { title: "x402 — Payment Required", url: "https://x402.org/", description: "An open standard for paying for HTTP requests with stablecoins." },
            ],
            provider: "duckduckgo",
            latency_ms: 480,
          },
        },
      } },
  },
  facilitator as any
);

// x402-next's paymentMiddleware exposes no response hook. Wrap it: on a 402,
// add a PAYMENT-REQUIRED header carrying the base64-encoded v1 challenge that
// already lives in the JSON body. Additive only — the body is written back
// byte-for-byte, so v1 clients (which read the body) are unaffected. Directory
// probes (402 Index, x402scan) classify x402 on response-header presence and
// never read the body.
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const res = await inner(req);
  if (res.status !== 402) return res;

  const body = await res.text();
  const headers = new Headers(res.headers);
  headers.set("PAYMENT-REQUIRED", Buffer.from(body, "utf8").toString("base64"));
  headers.delete("content-length"); // recomputed from the (identical) body

  return new NextResponse(body, { status: 402, statusText: res.statusText, headers });
}

export const config = {
  matcher: ["/api/risk/pro", "/api/risk/live/pro", "/api/llm", "/api/scrape", "/api/extract", "/api/embed", "/api/search"],
  runtime: "nodejs",
};
