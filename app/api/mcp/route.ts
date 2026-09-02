// app/api/mcp/route.ts — FREE MCP server. Discovery layer for the store.
// Agents connect, list tools, and get told exactly what to call and what it costs.
// Free tools execute inline; paid tools return the x402 endpoint + price.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://uxus.finance";
const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";

const TOOLS = [
  { name: "catalog", price: "0.00", endpoint: `${BASE}/api/catalog`, method: "GET",
    description: "FREE. List every service in the store with prices and parameters.",
    inputSchema: { type: "object", properties: {} } },
  { name: "risk_check_free", price: "0.00", endpoint: `${BASE}/api/risk`, method: "GET",
    description: "FREE. Quick risk verdict for an EVM address: score, level, PROCEED/CAUTION/BLOCK.",
    inputSchema: { type: "object", properties: {
      address: { type: "string", description: "0x EVM address" },
      chain: { type: "string", description: "ethereum or base" } }, required: ["address"] } },
  { name: "lookup", price: "0.00", endpoint: `${BASE}/api/lookup`, method: "GET",
    description: "FREE. Universal reverse lookup for any address on any chain (EVM + XRPL) — chain auto-detected from the address format, no chain parameter. Returns { address, chain, chain_detected, exists, risk_score, risk_level, verdict, flags, upgrade }.",
    inputSchema: { type: "object", properties: {
      address: { type: "string", description: "EVM 0x address or XRPL classic r-address" },
      chain: { type: "string", description: "optional EVM history hint: base (default) or ethereum" } }, required: ["address"] } },
  { name: "llm", price: "0.01", endpoint: `${BASE}/api/llm`, method: "POST",
    description: "LLM inference without an API key. $0.01 USDC on Base per call.",
    inputSchema: { type: "object", properties: {
      prompt: { type: "string" }, model: { type: "string" }, max_tokens: { type: "number" } }, required: ["prompt"] } },
  { name: "scrape", price: "0.01", endpoint: `${BASE}/api/scrape`, method: "GET",
    description: "Fetch any URL as clean markdown or text. Gets past common bot-blocking. $0.01 USDC on Base.",
    inputSchema: { type: "object", properties: {
      url: { type: "string" }, format: { type: "string", enum: ["markdown","text","html"] },
      max_chars: { type: "number" } }, required: ["url"] } },
  { name: "extract", price: "0.01", endpoint: `${BASE}/api/extract`, method: "POST",
    description: "Messy text or a web page into structured JSON matching your schema. $0.01 USDC on Base.",
    inputSchema: { type: "object", properties: {
      schema: { type: "object" }, text: { type: "string" }, url: { type: "string" } }, required: ["schema"] } },
  { name: "embed", price: "0.01", endpoint: `${BASE}/api/embed`, method: "POST",
    description: "Text to embedding vectors (1024 dims). Batch up to 64. $0.01 USDC on Base.",
    inputSchema: { type: "object", properties: { input: {} }, required: ["input"] } },
  { name: "search", price: "0.01", endpoint: `${BASE}/api/search`, method: "GET",
    description: "Live web search as clean JSON. $0.01 USDC on Base.",
    inputSchema: { type: "object", properties: {
      q: { type: "string" }, count: { type: "number" } }, required: ["q"] } },
  { name: "risk_check", price: "0.01", endpoint: `${BASE}/api/risk/pro`, method: "GET",
    description: "Full EVM wallet/token risk report: sanctions, scam lists, honeypot signals, reasons and sources. $0.01 USDC on Base.",
    inputSchema: { type: "object", properties: {
      address: { type: "string" }, chain: { type: "string" }, type: { type: "string" } }, required: ["address"] } },
];

function rpc(id: any, result: any) { return NextResponse.json({ jsonrpc: "2.0", id, result }); }
function rpcErr(id: any, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}
function textResult(obj: any) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return rpcErr(null, -32700, "Parse error"); }
  const { id, method, params } = body ?? {};

  if (method === "initialize") {
    return rpc(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "uxus-agent-services", version: "1.0.0" },
      instructions: "Pay-per-call agent primitives on Base. Free tools run inline. Paid tools return an x402 endpoint you pay in USDC — no account or API key needed.",
    });
  }

  if (method === "notifications/initialized") return NextResponse.json({ jsonrpc: "2.0" });

  if (method === "tools/list") {
    return rpc(id, {
      tools: TOOLS.map(t => ({
        name: t.name,
        description: t.price === "0.00" ? t.description : `${t.description}`,
        inputSchema: t.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) return rpcErr(id, -32602, `Unknown tool: ${name}`);

    // Free tools run inline.
    if (tool.price === "0.00") {
      try {
        const url = new URL(tool.endpoint);
        for (const [k, v] of Object.entries(args)) url.searchParams.set(k, String(v));
        const r = await fetch(url.toString());
        return rpc(id, textResult(await r.json()));
      } catch (e: any) {
        return rpc(id, textResult({ error: String(e?.message ?? e) }));
      }
    }

    // Paid tools: hand back exactly how to pay.
    return rpc(id, textResult({
      payment_required: true,
      price_usdc: tool.price,
      network: "base",
      pay_to: PAY_TO,
      protocol: "x402",
      endpoint: tool.endpoint,
      http_method: tool.method,
      arguments: args,
      how: tool.method === "GET"
        ? `GET ${tool.endpoint} with these query params, using an x402-capable client. You will receive a 402 with payment requirements, pay ${tool.price} USDC on Base, and retry.`
        : `POST ${tool.endpoint} with this JSON body, using an x402-capable client. You will receive a 402 with payment requirements, pay ${tool.price} USDC on Base, and retry.`,
    }));
  }

  return rpcErr(id, -32601, `Method not found: ${method}`);
}

export async function GET() {
  return NextResponse.json({
    server: "uxus-agent-services",
    transport: "MCP over HTTP (JSON-RPC 2.0)",
    endpoint: `${BASE}/api/mcp`,
    methods: ["initialize", "tools/list", "tools/call"],
    tools: TOOLS.map(t => ({ name: t.name, price_usdc: t.price, endpoint: t.endpoint })),
    payment: { protocol: "x402", network: "base", asset: "USDC", pay_to: PAY_TO },
  });
}
