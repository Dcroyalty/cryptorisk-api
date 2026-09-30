// lib/x402v2/catalog.ts — the multi-rail (x402 v2) twins of the seven paid v1
// routes. Each /api/v2/* route runs the SAME handler as its v1 twin; only the
// payment layer differs (USDC on Base, Polygon or Solana, x402 v2, settled by
// the CDP facilitator AFTER the handler succeeds).
// Descriptions stay under ~480 chars (CDP verify rejects ~500+).

export type RailRouteId = "risk-pro" | "risk-live-pro" | "search" | "scrape" | "extract" | "embed" | "llm";

export interface RailRouteDef {
  id: RailRouteId;
  method: "GET" | "POST";
  v2Path: string;
  v1Path: string;
  description: string;
  discovery: Record<string, unknown>;
}

const RAILS_NOTE = "Pay $0.01 per call in USDC on Base, Polygon or Solana (x402 v2), no API key or account.";

export const RAIL_ROUTES: Record<RailRouteId, RailRouteDef> = {
  "risk-pro": {
    id: "risk-pro",
    method: "GET",
    v2Path: "/api/v2/risk/pro",
    v1Path: "/api/risk/pro",
    description: `Wallet & token risk report for AI agents. ${RAILS_NOTE} GET ?address=0x... (required), chain=ethereum|base, type=wallet|token. Checks OFAC sanctions, scam/phishing lists and honeypot/tax/mint signals; returns risk_score 0-100, a PROCEED|CAUTION|BLOCK verdict, flags, reasons and sources.`,
    discovery: {
      method: "GET",
      input: { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "base" },
      inputSchema: {
        properties: {
          address: { type: "string", description: "0x EVM address (wallet or token contract)" },
          chain: { type: "string", description: "ethereum | base (default base)" },
          type: { type: "string", description: "wallet | token (default wallet)" },
        },
        required: ["address"],
      },
      output: { example: { address: "0xd8da...6045", risk_score: 0, risk_level: "low", verdict: "PROCEED", flags: ["CLEAN"] } },
    },
  },
  "risk-live-pro": {
    id: "risk-live-pro",
    method: "GET",
    v2Path: "/api/v2/risk/live/pro",
    v1Path: "/api/risk/live/pro",
    description: `Can this token's owner still turn it hostile? ${RAILS_NOTE} GET ?address=0x... (token contract, required), chain=ethereum|base. Direct on-chain reads (owner, pendingOwner, paused, EIP-1967 slots); returns mutable_risk_score, verdict, can_turn_hostile, time_to_rug and every owner power explained.`,
    discovery: {
      method: "GET",
      input: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base" },
      inputSchema: {
        properties: {
          address: { type: "string", description: "0x token contract address" },
          chain: { type: "string", description: "ethereum | base (default base)" },
        },
        required: ["address"],
      },
      output: { example: { mutable_risk_score: 20, verdict: "CAUTION", can_turn_hostile: true, time_to_rug: "immediate" } },
    },
  },
  search: {
    id: "search",
    method: "GET",
    v2Path: "/api/v2/search",
    v1Path: "/api/search",
    description: `Live web search for AI agents. ${RAILS_NOTE} GET ?q=QUERY (required), count=1-20, country, language, page. Returns results [{title,url,description,score}] plus people_also_ask, related_searches, knowledge_graph, answer_box and ai_overview when the Google-backed provider answers.`,
    discovery: {
      method: "GET",
      input: { q: "x402 payment protocol", count: "5" },
      inputSchema: {
        properties: {
          q: { type: "string", description: "Search query" },
          count: { type: "string", description: "Number of results, 1-20 (default 10)" },
        },
        required: ["q"],
      },
      output: { example: { query: "x402 payment protocol", results: [{ title: "x402", url: "https://x402.org/", score: 1 }] } },
    },
  },
  scrape: {
    id: "scrape",
    method: "GET",
    v2Path: "/api/v2/scrape",
    v1Path: "/api/scrape",
    description: `Fetch any URL as clean, LLM-ready content. ${RAILS_NOTE} GET ?url=... (required), format=markdown|text|html, max_chars (default 40000). Returns {url, status, title, description, content, truncated, chars}.`,
    discovery: {
      method: "GET",
      input: { url: "https://example.com", format: "markdown" },
      inputSchema: {
        properties: {
          url: { type: "string", description: "Absolute URL to fetch" },
          format: { type: "string", description: "markdown | text | html" },
        },
        required: ["url"],
      },
      output: { example: { url: "https://example.com", status: 200, title: "Example Domain", content: "# Example Domain ..." } },
    },
  },
  extract: {
    id: "extract",
    method: "POST",
    v2Path: "/api/v2/extract",
    v1Path: "/api/extract",
    description: `Structured JSON from messy text or a web page. ${RAILS_NOTE} POST JSON {schema: {field: type}, text or url}. An LLM fills the schema; missing fields come back null. Returns {data, model, latency_ms}.`,
    discovery: {
      method: "POST",
      bodyType: "json",
      input: { schema: { title: "string", price: "number" }, url: "https://example.com" },
      inputSchema: {
        properties: {
          schema: { type: "object", description: "Fields you want, e.g. {title: string}" },
          text: { type: "string", description: "Source text (or give url)" },
          url: { type: "string", description: "Page to fetch (or give text)" },
        },
        required: ["schema"],
      },
      output: { example: { data: { title: "Example", price: 19.99 }, model: "deepseek/deepseek-chat" } },
    },
  },
  embed: {
    id: "embed",
    method: "POST",
    v2Path: "/api/v2/embed",
    v1Path: "/api/embed",
    description: `Text embeddings (jina-embeddings-v3, 1024 dims). ${RAILS_NOTE} POST JSON {input: string or string[] (max 64)}. Returns {model, embeddings, dimensions, count, usage}.`,
    discovery: {
      method: "POST",
      bodyType: "json",
      input: { input: "hello world" },
      inputSchema: {
        properties: { input: { type: "string", description: "Text, or an array of up to 64 strings" } },
        required: ["input"],
      },
      output: { example: { model: "jina-embeddings-v3", dimensions: 1024, count: 1 } },
    },
  },
  llm: {
    id: "llm",
    method: "POST",
    v2Path: "/api/v2/llm",
    v1Path: "/api/llm",
    description: `LLM chat completions for AI agents, with a 5-model fallback chain. ${RAILS_NOTE} POST JSON {prompt} or {messages: [{role, content}]}; optional model, max_tokens (max 2000). Returns {model, content, usage, latency_ms}.`,
    discovery: {
      method: "POST",
      bodyType: "json",
      input: { prompt: "Say hello" },
      inputSchema: {
        properties: {
          prompt: { type: "string", description: "User prompt (or give messages)" },
          messages: { type: "array", description: "Chat messages [{role, content}]" },
          max_tokens: { type: "number", description: "Default 800, max 2000" },
        },
      },
      output: { example: { model: "deepseek/deepseek-chat", content: "Hello!" } },
    },
  },
};
