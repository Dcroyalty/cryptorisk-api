import { NextRequest, NextResponse } from "next/server";
import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";
import { guard, KEY_FORMAT } from "@/lib/keys";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const N = "base" as Network;

const inner = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": { price: "$0.01", network: N,
      config: {
        description: "Full wallet & token risk report — no API key, no account, no signup; pay per call in USDC on Base. GET ?address=0x... (required), chain=ethereum|base (default base), type=wallet|token (default wallet). Checks OFAC sanctions, scam/phishing lists, and honeypot/tax/mint signals. Returns risk_score 0-100, risk_level, a PROCEED|CAUTION|BLOCK verdict, flags[], reasons[] with severity, raw signals, and sources[]. For agents screening a counterparty before they transact.",
        inputSchema: {
          queryParams: {
            address: "0x EVM address (wallet or token contract). Required.",
            chain: "ethereum | base. Default base.",
            type: "wallet | token. Default wallet.",
          },
        },
        outputSchema: {
          type: "json",
          example: {
            address: "0xd8da...6045", chain: "base", type: "wallet",
            risk_score: 0, risk_level: "low", verdict: "PROCEED", flags: ["CLEAN"],
            reasons: [{ code: "CLEAN", severity: 0, detail: "no sanctions or scam-list matches", source: "uxus" }],
            signals: { wallet_age_days: 1135, tx_count: 42 },
            sources: ["ofac", "scamsniffer", "mew"], checked_at: "2026-09-03T00:00:00Z",
          },
        },
      } },
    "/api/risk/live/pro": { price: "$0.01", network: N,
      config: {
        description: "Mutable-risk report for a token — can the owner still turn it hostile? No API key, no account, no signup; pay per call in USDC on Base. GET ?address=0x... (required), chain=ethereum|base (default base). Direct on-chain reads only: eth_getCode, owner(), pendingOwner(), paused(), EIP-1967 slots. Returns mutable_risk_score, verdict, can_turn_hostile, time_to_rug, every owner power explained in plain English, and raw controls. For agents holding or about to buy a token.",
        inputSchema: {
          queryParams: {
            address: "0x token contract address. Required.",
            chain: "ethereum | base. Default base.",
          },
        },
        outputSchema: {
          type: "json",
          example: {
            address: "0x...", chain: "base", mutable_risk_score: 20, verdict: "CAUTION",
            can_turn_hostile: true, time_to_rug: "immediate",
            powers_explained: [{ code: "OWNER_RETAINS_PRIVILEGES", meaning: "Ownership not renounced; owner-only functions remain callable." }],
            controls: {}, tier: "pro",
          },
        },
      } },
    "/api/llm":      { price: "$0.01", network: N,
      config: {
        description: "LLM chat completions for AI agents — no API key, no account, no signup; pay per call in USDC on Base. POST JSON { prompt } or { messages: [{ role, content }] }; optional model (OpenRouter slug), max_tokens (default 800, max 2000). Routes across a 5-model fallback chain so one unavailable model doesn't fail the call. Returns { model, content, usage, latency_ms }. For agents that need inference without holding an OpenAI or Anthropic key.",
        inputSchema: {
          bodyType: "json",
          bodyFields: {
            prompt: { type: "string", description: "User prompt. Provide this or messages[]." },
            messages: { type: "array", description: "Chat messages [{ role, content }]. Alternative to prompt." },
            model: { type: "string", description: "Optional model slug; still falls back through the chain." },
            max_tokens: { type: "number", description: "Max completion tokens. Default 800, max 2000." },
          },
        },
        outputSchema: {
          type: "json",
          example: {
            model: "deepseek/deepseek-chat", content: "The answer is ...",
            usage: { prompt_tokens: 24, completion_tokens: 80, total_tokens: 104 }, latency_ms: 1200,
          },
        },
      } },
    "/api/scrape":   { price: "$0.01", network: N,
      config: {
        description: "Fetch any URL and get clean, LLM-ready page content — no API key, no account, no signup; pay per call in USDC on Base. Gets past common bot-blocking. Params: ?url=... (required), format=markdown|text|html (default markdown), max_chars=N (default 40000, max 120000). Returns { url, status, title, description, format, content, truncated, chars, latency_ms }; non-HTML URLs return raw content. For agents that need a page as text before summarising or extracting.",
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
            description: "meta description text",
            format: "markdown",
            content: "# Example Article ...clean markdown...",
            truncated: false,
            chars: 1840,
            latency_ms: 620,
          },
        },
      } },
    "/api/extract":  { price: "$0.01", network: N,
      config: {
        description: "Pull structured JSON out of messy text or a web page — no API key, no account, no signup; pay per call in USDC on Base. POST JSON { schema: { field: type, ... } (required), and text or url }. If url is given the page is fetched and stripped first; an LLM fills the schema and missing fields come back null. Returns { data, model, latency_ms }. For agents turning an article, listing, or product page into typed fields.",
        inputSchema: {
          bodyType: "json",
          bodyFields: {
            schema: { type: "object", description: "Fields you want, e.g. { title: string, price: number }. Required." },
            text: { type: "string", description: "Raw source text. Provide this or url." },
            url: { type: "string", description: "Page to fetch and extract from. Provide this or text." },
          },
        },
        outputSchema: {
          type: "json",
          example: {
            data: { title: "Example", price: 19.99, in_stock: true },
            model: "deepseek/deepseek-chat", latency_ms: 900,
          },
        },
      } },
    "/api/embed":    { price: "$0.01", network: N,
      config: {
        description: "Text embeddings for AI agents — no API key, no account, no signup; pay per call in USDC on Base. POST JSON { input: string or string[] (max 64 per call) }. Model is jina-embeddings-v3, 1024 dimensions, retrieval.passage task. Returns { model, embeddings (one vector per input), dimensions, count, usage, latency_ms }. For agents building a vector index or doing semantic search without a Jina or OpenAI key.",
        inputSchema: {
          bodyType: "json",
          bodyFields: {
            input: { type: "string | string[]", description: "Text to embed, or an array of up to 64 strings." },
          },
        },
        outputSchema: {
          type: "json",
          example: {
            model: "jina-embeddings-v3",
            embeddings: [[0.013, -0.021, 0.005]],
            dimensions: 1024, count: 1, usage: { total_tokens: 8 }, latency_ms: 300,
          },
        },
      } },
    "/api/search":   { price: "$0.01", network: N,
      config: {
        description: "Live web search for AI agents — no API key, no account, no signup; pay per call in USDC on Base. GET ?q=YOUR+QUERY (required), count=N (1-20, default 10). Returns { query, results: [{ title, url, description, score }], provider, latency_ms }; score is 1.0 for the top result descending toward 0.1, so you can rank or threshold. Multiple search backends with automatic failover. For agents grounding an answer in current web data or gathering source URLs to scrape.",
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
              { title: "x402 — Payment Required", url: "https://x402.org/", description: "An open standard for paying for HTTP requests with stablecoins.", score: 1 },
            ],
            provider: "duckduckgo",
            latency_ms: 480,
          },
        },
      } },
  },
  facilitator as any
);

// Paths whose PAID operation is POST (llm/extract/embed). A GET there is the
// free self-doc handler — don't gate it, or callers probing for usage get a 402
// instead of the docs. scrape/search are GET-paid, so they stay gated.
const DOC_GET_PATHS = new Set(["/api/llm", "/api/extract", "/api/embed"]);

// x402-next's paymentMiddleware exposes no response hook. Wrap it: on a 402,
// add a PAYMENT-REQUIRED header carrying the base64-encoded v1 challenge that
// already lives in the JSON body. Additive only — the body is written back
// byte-for-byte, so v1 clients (which read the body) are unaffected. Directory
// probes (402 Index, x402scan) classify x402 on response-header presence and
// never read the body.
// Stripe-subscription API keys are a second, independent way to reach
// /api/risk/pro — a valid key with quota remaining bypasses the x402 payment
// gate entirely. No key, or a key that doesn't match our format, falls
// through to the exact same x402 flow as before (x402 is unchanged for
// anyone not presenting one of our keys). guard() is the ONLY quota check —
// there is no second quota system anywhere else.
const QUOTA_GATED_PATHS = new Set(["/api/risk/pro"]);

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const pathname = new URL(req.url).pathname;

  if (req.method === "GET" && DOC_GET_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (QUOTA_GATED_PATHS.has(pathname)) {
    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(\S+)$/);
    if (m && KEY_FORMAT.test(m[1])) {
      const result = await guard(m[1]);
      if (result.ok) {
        const res = NextResponse.next();
        res.headers.set("x-uxus-plan", result.plan);
        res.headers.set("x-uxus-quota-remaining", String(result.remaining));
        return res;
      }
      if (result.reason === "quota_exceeded") {
        return NextResponse.json({ error: "quota_exceeded", message: result.message }, { status: 429 });
      }
      // "inactive" or "invalid_key" (format matched but not found/live) — a
      // clear error, not a silent fall-through to demanding an x402 payment.
      return NextResponse.json({ error: result.reason, message: result.message }, { status: 402 });
    }
  }

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
