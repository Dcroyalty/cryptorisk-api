// app/api/catalog/route.ts — FREE. The storefront index for agents.
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://uxus.finance";

export async function GET() {
  return NextResponse.json({
    store: "UXUS Agent Services",
    description: "Pay-per-call primitives for AI agents. No accounts, no API keys — just a USDC wallet on Base.",
    payment: { protocol: "x402", network: "base", asset: "USDC", pay_to: "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de" },
    services: [
      { id: "llm", method: "POST", url: `${BASE}/api/llm`, price_usd: "0.01",
        summary: "AI inference. POST {prompt} or {messages[]} -> completion.",
        params: { prompt: "string", messages: "array (optional)", model: "string (optional)", max_tokens: "number (optional, max 2000)" } },
      { id: "scrape", method: "GET", url: `${BASE}/api/scrape`, price_usd: "0.01",
        summary: "Any URL -> clean markdown/text plus title and description.",
        params: { url: "required", format: "markdown|text|html", max_chars: "number" } },
      { id: "extract", method: "POST", url: `${BASE}/api/extract`, price_usd: "0.01",
        summary: "Messy text or a URL -> structured JSON matching your schema.",
        params: { schema: "object (required)", text: "string", url: "string" } },
      { id: "embed", method: "POST", url: `${BASE}/api/embed`, price_usd: "0.01",
        summary: "Text -> embedding vectors (jina-embeddings-v3). Batch up to 64.",
        params: { input: "string or string[]" } },
      { id: "search", method: "GET", url: `${BASE}/api/search`, price_usd: "0.01",
        summary: "Live web search -> clean JSON results.",
        params: { q: "required", count: "number (max 20)" } },
      { id: "risk", method: "GET", url: `${BASE}/api/risk/pro`, price_usd: "0.01",
        summary: "EVM wallet/token risk: OFAC sanctions, scam lists, honeypot signals, 0-100 score.",
        params: { address: "required 0x address", chain: "ethereum|base", type: "wallet|token" } },
      { id: "risk_free", method: "GET", url: `${BASE}/api/risk`, price_usd: "0.00",
        summary: "FREE demo of risk scoring: score, level, verdict, flags.",
        params: { address: "required 0x address", chain: "ethereum|base" } },
    ],
    docs: `${BASE}/llms.txt`,
    discovery: `${BASE}/.well-known/x402.json`,
  }, { status: 200 });
}
