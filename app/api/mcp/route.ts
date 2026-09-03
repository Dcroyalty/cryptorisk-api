// app/api/mcp/route.ts — UXUS Agent Services MCP server (Streamable HTTP).
//
// Spec: modelcontextprotocol.io 2025-06-18. Stateless (no Mcp-Session-Id).
// - POST  /api/mcp   JSON-RPC 2.0. Honors Accept: text/event-stream (SSE-framed reply).
// - GET   /api/mcp   Accept: text/event-stream -> keepalive SSE stream (no server msgs).
//                    otherwise -> plain metadata JSON for humans/curl.
//
// v1 exposes FREE tools only — there is no stable paid-MCP convention and a tool
// a client cannot pay for looks broken. Free results whose paid HTTP counterpart
// adds real capability carry an `upgrade` field: endpoint, price, what it adds.
// A funnel, not a paywall.
import { NextRequest } from "next/server";
import { searchWeb, SearchError } from "@/lib/search-core";
import { scrapeUrl, ScrapeError } from "@/lib/scrape-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://uxus.finance";
const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = "2025-06-18";
const SERVER_INFO = { name: "uxus-agent-services", title: "UXUS Agent Services", version: "1.1.0" };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, Mcp-Session-Id",
};

// ---- upgrade pointer (funnel) ----
const RISK_UPGRADE = {
  tool: "risk_report (HTTP, paid)",
  endpoint: `${BASE}/api/risk/pro`,
  price: "$0.01 USDC on Base (x402)",
  adds:
    "per-signal reasons with severity, the raw signals object (token buy/sell tax, mint/proxy/hidden-owner flags, or wallet age + tx count), and the source list behind every flag",
};

// ---- tool catalogue (priority order: search + extraction first, risk is saturated) ----
type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

async function proxyGet(path: string, args: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { headers: { accept: "application/json" } });
  return r.json();
}

const TOOLS: ToolDef[] = [
  {
    name: "search_web",
    description:
      "Live web search. Query the web and get ranked results — no API key, no account, no signup. Params: query (string, required); count (integer 1-20, default 10). Returns { query, results: [{ title, url, description, score }], provider, latency_ms }; score is 1.0 for the top result descending toward 0.1, so you can rank or threshold. Multiple search backends with automatic failover. For grounding an answer in current information or finding source URLs to read.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query. Required." },
        count: { type: "integer", minimum: 1, maximum: 20, default: 10, description: "Number of results, 1-20. Default 10." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (a) => {
      try {
        return await searchWeb(String(a.query ?? ""), Number(a.count) || 10);
      } catch (e) {
        if (e instanceof SearchError) return { error: "search_failed", detail: e.message };
        throw e;
      }
    },
  },
  {
    name: "scrape_url",
    description:
      "Fetch a web page and return clean, LLM-ready content — no API key, no account, no signup. Gets past common bot-blocking. Params: url (absolute http/https URL, required); format (markdown | text | html, default markdown); max_chars (integer, default 40000, max 120000). Returns { url, status, title, description, format, content, truncated, chars }. Non-HTML URLs return raw content. For reading an article, doc page, or listing before summarising or extracting.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http/https URL to fetch. Required." },
        format: { type: "string", enum: ["markdown", "text", "html"], default: "markdown", description: "Output format. Default markdown." },
        max_chars: { type: "integer", default: 40000, maximum: 120000, description: "Truncation limit. Default 40000, max 120000." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    run: async (a) => {
      try {
        return await scrapeUrl(String(a.url ?? ""), String(a.format ?? "markdown"), Number(a.max_chars) || 40000);
      } catch (e) {
        if (e instanceof ScrapeError) return { error: e.code, detail: e.message };
        throw e;
      }
    },
  },
  {
    name: "lookup_wallet",
    description:
      "Universal address lookup — any address, any chain, auto-detected. Params: address (EVM 0x address or XRPL classic r-address, required); chain (optional EVM history hint: base default, or ethereum). Detects EVM vs XRPL from the format. Returns one normalized envelope: { address, chain, chain_detected, exists, risk_score, risk_level, verdict, flags, entity, name }. Free. For a fast first-pass check on a counterparty wallet.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "EVM 0x address or XRPL classic r-address. Required." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Optional EVM history hint. Default base." },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => {
      const out = await proxyGet("/api/lookup", a);
      return { ...(out as object), upgrade: RISK_UPGRADE };
    },
  },
  {
    name: "resolve_name",
    description:
      "Bidirectional name <-> address resolution for ENS (name.eth) and Basenames (name.base.eth). Param: q (an ENS/Basename name, an EVM 0x address, or an XRPL r-address, required). Auto-detects direction. Reverse records are forward-verified against the address to stop name spoofing. Returns { query, kind, namespace, chain, resolved, address, name, sources }. XRPL .xrp names are detected but resolved:false (no canonical registry). Free.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "An ENS/Basename name, an EVM 0x address, or an XRPL classic r-address. Required." },
      },
      required: ["q"],
      additionalProperties: false,
    },
    run: (a) => proxyGet("/api/resolve", a),
  },
  {
    name: "check_entity",
    description:
      "Entity attribution — what IS this address, not who owns it. Params: address (0x EVM address, required); chain (base default, or ethereum). Returns { address, chain, is_known, label, category }. category is one of sanctioned, mixer, exchange, bridge, dex_router, scam, drainer, phishing, token_contract, protocol, unknown. Sourced from OFAC, ScamSniffer, MEW, eth-labels and curated Base/Tornado sets. Never guesses. Free.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x EVM address. Required." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Default base." },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => {
      const out = await proxyGet("/api/entity", a);
      return { ...(out as object), upgrade: RISK_UPGRADE };
    },
  },
  {
    name: "caller_id",
    description:
      "Should this wallet be answered? For wallet messaging (XMTP, Push), which has no spam filter. Params: address (0x EVM address, required); chain (base default, or ethereum). Composes entity attribution + risk score + on-chain history + forward-verified name into ANSWER | SCREEN | BLOCK with reasons[] and a confidence flag. BLOCK on sanctioned/drainer/phishing/scam/mixer or risk verdict BLOCK; SCREEN is the default for unknown addresses. Free.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x EVM address. Required." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Default base." },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: (a) => proxyGet("/api/callerid", a),
  },
  {
    name: "health",
    description: "Service health check. No parameters. Returns { ok, service, time, upstream } — confirms the uxus.finance API is reachable. Free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      let upstream = "unknown";
      try {
        const r = await fetch(`${BASE}/api/catalog`, { headers: { accept: "application/json" } });
        upstream = r.ok ? "ok" : `http_${r.status}`;
      } catch {
        upstream = "unreachable";
      }
      return { ok: upstream === "ok", service: SERVER_INFO.name, time: new Date().toISOString(), upstream };
    },
  },
];

const RESOURCES = [
  { uri: `${BASE}/openapi.json`, name: "openapi.json", title: "OpenAPI spec", mimeType: "application/json",
    description: "Full REST API spec for every uxus.finance endpoint, free and paid." },
  { uri: `${BASE}/llms.txt`, name: "llms.txt", title: "Service catalogue", mimeType: "text/plain",
    description: "Human/agent-readable catalogue of every service, price, and parameter." },
  { uri: `${BASE}/.well-known/x402.json`, name: "x402.json", title: "x402 discovery manifest", mimeType: "application/json",
    description: "x402 payment discovery manifest for the paid HTTP endpoints." },
];

// ---- JSON-RPC plumbing ----
type RpcId = string | number | null;
function ok(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function err(id: RpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

async function dispatch(method: string, params: Record<string, unknown>, id: RpcId): Promise<object> {
  switch (method) {
    case "initialize": {
      const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Free agent primitives on Base. All tools run inline, no key or account. search_web and scrape_url are the flagship tools. Results whose paid HTTP counterpart adds capability carry an `upgrade` field.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(id, -32602, `Unknown tool: ${name}`);
      try {
        const data = await tool.run(args);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "tool_failed", detail: String((e as Error)?.message ?? e) }) }],
        });
      }
    }
    case "resources/list":
      return ok(id, { resources: RESOURCES });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });
    case "resources/read": {
      const uri = typeof params?.uri === "string" ? params.uri : "";
      const res = RESOURCES.find((r) => r.uri === uri);
      if (!res) return err(id, -32602, `Unknown resource: ${uri}`);
      try {
        const r = await fetch(uri, { headers: { accept: res.mimeType } });
        const text = await r.text();
        return ok(id, { contents: [{ uri, mimeType: res.mimeType, text }] });
      } catch (e) {
        return err(id, -32603, `Failed to read resource: ${String((e as Error)?.message ?? e)}`);
      }
    }
    case "prompts/list":
      return ok(id, { prompts: [] });
    case "prompts/get":
      return err(id, -32602, "This server exposes no prompts");
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

function sseResponse(payload: object, status = 200): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status,
    headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" },
  });
}
function jsonResponse(payload: object, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest): Promise<Response> {
  // protocol version header validation (spec: unsupported -> 400)
  const pv = req.headers.get("mcp-protocol-version");
  if (pv && !SUPPORTED_PROTOCOLS.includes(pv)) {
    return jsonResponse(err(null, -32600, `Unsupported MCP-Protocol-Version: ${pv}`), 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(err(null, -32700, "Parse error"), 400);
  }

  const wantsSse = (req.headers.get("accept") || "").includes("text/event-stream");

  // JSON-RPC notification or response from client -> 202 Accepted, no body
  const isNotification = body.id === undefined || (typeof body.method === "string" && body.method.startsWith("notifications/"));
  if (isNotification) {
    return new Response(null, { status: 202, headers: CORS });
  }

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonResponse(err((body.id as RpcId) ?? null, -32600, "Invalid Request"), 400);
  }

  const id = (body.id as RpcId) ?? null;
  const params = (body.params ?? {}) as Record<string, unknown>;
  let payload: object;
  try {
    payload = await dispatch(body.method, params, id);
  } catch (e) {
    payload = err(id, -32603, `Internal error: ${String((e as Error)?.message ?? e)}`);
  }

  const status = "error" in payload && (payload as { error?: { code?: number } }).error?.code === -32600 ? 400 : 200;
  return wantsSse ? sseResponse(payload, status) : jsonResponse(payload, status);
}

export async function GET(req: NextRequest): Promise<Response> {
  const accept = req.headers.get("accept") || "";

  if (accept.includes("text/event-stream")) {
    // Streamable HTTP: server MAY open an SSE stream for server->client messages.
    // We have none; hold the stream open with keepalive comments so the client
    // does not treat GET as unsupported. Closes at the function timeout; clients reconnect.
    let timer: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        timer = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
          } catch {
            if (timer) clearInterval(timer);
          }
        }, 15000);
      },
      cancel() {
        if (timer) clearInterval(timer);
      },
    });
    return new Response(stream, {
      headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" },
    });
  }

  // plain metadata for humans / curl
  return jsonResponse({
    server: SERVER_INFO,
    transport: "Streamable HTTP (MCP 2025-06-18)",
    endpoint: `${BASE}/api/mcp`,
    protocolVersions: SUPPORTED_PROTOCOLS,
    stdio: "npx uxus-mcp  (zero config, proxies to this endpoint)",
    tools: TOOLS.map((t) => t.name),
    resources: RESOURCES.map((r) => r.uri),
    note: "Free tools only. Paid HTTP endpoints (search, scrape, risk, llm, extract, embed) settle via x402 — see /.well-known/x402.json.",
    payment: { protocol: "x402", network: "base", asset: "USDC", pay_to: PAY_TO },
  });
}
