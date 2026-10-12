import { NextRequest, NextResponse } from "next/server";
import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";
import { guard, KEY_FORMAT } from "@/lib/keys";
import { PAY_TO, CANONICAL_ORIGIN } from "@/lib/pay-to";

const N = "base" as Network;

// x402-next falls back to `${request.nextUrl.protocol}//${request.nextUrl.host}${pathname}`
// for the x402 `resource` field whenever a route omits `resource` — see
// node_modules/x402-next/dist/esm/index.js. cryptorisk-api.vercel.app is still a live
// alias to this same deployment, so without a pinned `resource` here, a payer hitting
// that host mints a second, separately-indexed CDP resource for the same endpoint.
// Every route below pins `resource` to the canonical origin so CDP only ever sees one.

const inner = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": { price: "$0.02", network: N,
      config: {
        resource: `${CANONICAL_ORIGIN}/api/risk/pro`,
        description: "One call, one verdict: PROCEED, CAUTION or BLOCK for any EVM wallet or token, with the reasons attached. $0.02 USDC per call on Base, no API key or account. GET ?address=0x... (required), chain=base|ethereum, type=wallet|token. Checks the OFAC SDN list (synced daily), scam and phishing lists, and honeypot, tax and mint signals. Returns verdict, a one-line summary, reasons[] strongest first, risk_score 0-100 and sources. Never PROCEED when a source could not be checked.",
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
            verdict: "PROCEED", summary: "PROCEED: no sanctions, scam-list or risk signal found.",
            reasons: [{ code: "CLEAN", severity: 0, detail: "no sanctions or scam-list matches", source: "uxus" }],
            risk_score: 0, risk_level: "low", flags: ["CLEAN"], degraded: false,
            address: "0xd8da...6045", chain: "base", type: "wallet",
            signals: { wallet_age_days: 1135, tx_count: 42 },
            sources: ["ofac", "scamsniffer", "mew"], checked_at: "2026-09-03T00:00:00Z",
          },
        },
      } },
    "/api/risk/live/pro": { price: "$0.02", network: N,
      config: {
        resource: `${CANONICAL_ORIGIN}/api/risk/live/pro`,
        description: "One call, one verdict on a token's owner powers: PROCEED, CAUTION or BLOCK, with the reasons attached. $0.02 USDC per call on Base, no API key. GET ?address=0x... (token contract, required), chain=base|ethereum. Reads the chain directly: owner, pause switch, pending owner, upgradeable proxy. Tells you whether the owner can still pause, upgrade or rug it. Returns verdict, a one-line summary, reasons[] strongest first, can_turn_hostile, time_to_rug and the raw controls.",
        inputSchema: {
          queryParams: {
            address: "0x token contract address. Required.",
            chain: "ethereum | base. Default base.",
          },
        },
        outputSchema: {
          type: "json",
          example: {
            verdict: "CAUTION", summary: "CAUTION: Ownership is not renounced. Owner-only functions (fees, limits, blacklists) remain callable.",
            reasons: [{ code: "OWNER_RETAINS_PRIVILEGES", severity: 4, detail: "Ownership is not renounced. Owner-only functions (fees, limits, blacklists) remain callable.", source: "onchain" }],
            hold_verdict: "MONITOR", address: "0x...", chain: "base", mutable_risk_score: 20,
            can_turn_hostile: true, time_to_rug: "delayed",
            controls: {}, tier: "pro",
          },
        },
      } },
    "/api/llm":      { price: "$0.01", network: N,
      config: {
        resource: `${CANONICAL_ORIGIN}/api/llm`,
        description: "LLM chat completion. $0.01 USDC per call on Base, no API key. POST JSON { prompt } or { messages: [{ role, content }] }; optional model (OpenRouter slug) and max_tokens (default 800, max 2000). Falls back across up to 5 models so one outage does not fail the call. Returns { content, model, usage, latency_ms }.",
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
        resource: `${CANONICAL_ORIGIN}/api/scrape`,
        description: "Any URL as clean, LLM-ready content. $0.01 USDC per call on Base, no API key. GET ?url=... (required), format=markdown|text|html (default markdown), max_chars (default 40000, max 120000). Returns { title, description, content, status, truncated, chars, latency_ms }. Non-HTML URLs come back as raw content.",
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
        resource: `${CANONICAL_ORIGIN}/api/extract`,
        description: "Structured JSON from a web page or text, with exactly the fields you ask for. $0.01 USDC per call on Base, no API key. POST JSON { schema: { field: type, ... } (required), plus url or text }. Returns { data } with your schema's keys (null when a field is not in the source), the model used and latency_ms. Page fetch capped at 10 s, whole call at 45 s, so it never hangs.",
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
        resource: `${CANONICAL_ORIGIN}/api/embed`,
        description: "Text embeddings. $0.01 USDC per call on Base, no API key. POST JSON { input: a string or up to 64 strings }. Model jina-embeddings-v3, 1024 dimensions. Returns { embeddings (one vector per input), dimensions, count, usage, latency_ms }.",
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
        resource: `${CANONICAL_ORIGIN}/api/search`,
        description: "Live web search results. $0.01 USDC per call on Base, no API key. GET ?q=... (required), count 1-20 (default 10), optional country, language, page. Returns results[{ title, url, description, score }], plus Google's answer box, knowledge graph, people-also-ask, related searches and shopping when the Google-backed provider answers (empty on fallback).",
        inputSchema: {
          queryParams: {
            q: "Search query. Required.",
            count: "Number of results, 1-20. Default 10.",
            country: "2-letter country code (Google gl param). Optional.",
            language: "2+ letter language code (Google hl param). Optional.",
            page: "1-based result page. Optional.",
            device: "Forwarded to the upstream provider if set. Not confirmed to change results on every provider. Optional.",
          },
        },
        outputSchema: {
          type: "json",
          example: {
            query: "x402 payment protocol",
            results: [
              { title: "x402 — Payment Required", url: "https://x402.org/", description: "An open standard for paying for HTTP requests with stablecoins.", score: 1 },
            ],
            ads: [],
            people_also_ask: [],
            related_searches: ["x402 protocol coinbase", "http 402 payment required"],
            knowledge_graph: null,
            answer_box: null,
            shopping: [],
            ai_overview: null,
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

// The old Vercel preview domain — still a live alias to this same production
// deployment. We have no Vercel dashboard/CLI access from here to remove or
// redirect the alias at the platform level, so retire it in-app instead: any
// request arriving on this host is 301'd to the canonical domain before it
// can reach the paywall, so nothing can ever complete an x402 payment against
// it again (the `resource` pin above already stops it being indexed as a
// separate CDP resource even without this redirect — this closes the rest).
const OLD_HOST = "cryptorisk-api.vercel.app";

// Facilitator outage vs. a genuinely invalid payment. x402's facilitator client
// throws "Failed to verify|settle payment: <HTTP status>" for a non-JSON/5xx
// response, while a real rejection carries a snake_case invalidReason
// ("Failed to verify payment: insufficient_funds") — only the former, plus
// network/JSON-parse failures, counts as an outage.
const OUTAGE_RE =
  /Failed to (verify|settle) payment: (5\d\d|429|408)\b|fetch failed|Unexpected token|not valid JSON|Unexpected end of JSON|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|UND_ERR/i;

// The X-PAYMENT header is base64 JSON. x402-next decodes it BEFORE calling the
// facilitator, and a malformed header throws the same JSON-parse errors a
// broken facilitator response would. Only treat a parse error as an outage
// when the header itself decodes — then the bad JSON came from the facilitator.
function paymentHeaderDecodes(h: string): boolean {
  try {
    const p = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    return !!p && typeof p === "object" && "payload" in p;
  } catch {
    return false;
  }
}

function facilitatorOutage(body: string): string | null {
  try {
    const err = String(JSON.parse(body)?.error ?? "");
    return OUTAGE_RE.test(err) ? err : null;
  } catch {
    return null;
  }
}

// Where a caller can still get an answer while x402 settlement is down.
const OUTAGE_ALTERNATIVES: Record<string, string> = {
  "/api/risk/pro":
    "Subscribers: send Authorization: Bearer <your uxus API key> — key access does not depend on the facilitator. Free: GET /api/risk?address=... (sanctions + scam lists, verdict only).",
  "/api/risk/live/pro": "Free: GET /api/risk/live?address=... (verdict only).",
  "/api/search": "Free: the search_web tool on the MCP endpoint POST /api/mcp.",
  "/api/scrape": "Free: the scrape_url tool on the MCP endpoint POST /api/mcp.",
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);

  if (url.hostname === OLD_HOST) {
    url.protocol = "https:";
    url.hostname = "uxus.finance";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  const pathname = url.pathname;

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

  // A payment was presented but the CDP facilitator itself failed (network
  // error, 5xx/429, non-JSON body) — not a rejected payment. x402-next reports
  // that as a plain 402, which a client reads as "your payment was refused" and
  // either gives up or re-signs forever. Say what actually happened instead:
  // 503 + Retry-After, nothing was charged, and where to go meanwhile.
  const xPayment = req.headers.get("x-payment");
  if (xPayment && paymentHeaderDecodes(xPayment)) {
    const outage = facilitatorOutage(body);
    if (outage) {
      console.error("[x402] facilitator unavailable", pathname, outage);
      return NextResponse.json(
        {
          error: "payment_facilitator_unavailable",
          detail:
            "The x402 payment facilitator (Coinbase CDP) is not responding. Your payment was NOT settled — you have not been charged. Retry the same request in about a minute.",
          retry_after_seconds: 60,
          ...(OUTAGE_ALTERNATIVES[pathname] ? { meanwhile: OUTAGE_ALTERNATIVES[pathname] } : {}),
        },
        { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
      );
    }
  }

  const headers = new Headers(res.headers);
  headers.set("PAYMENT-REQUIRED", Buffer.from(body, "utf8").toString("base64"));
  headers.delete("content-length"); // recomputed from the (identical) body

  return new NextResponse(body, { status: 402, statusText: res.statusText, headers });
}

export const config = {
  // Broadened from the 7 paid routes to every path so the OLD_HOST redirect
  // above retires the whole cryptorisk-api.vercel.app alias, not just the
  // paywalled ones. Excludes Next's own static/image assets — redirecting
  // those too would just add pointless hops for anything already mid-load.
  // _vercel/ (Web Analytics beacon) is platform-owned and never paid.
  matcher: ["/((?!_next/static|_next/image|_vercel/|favicon.ico).*)"],
  runtime: "nodejs",
};
