// app/api/mcp/route.ts — UXUS Agent Services MCP server (Streamable HTTP).
//
// Spec: modelcontextprotocol.io 2025-06-18. Stateless (no Mcp-Session-Id).
// - POST  /api/mcp   JSON-RPC 2.0. Honors Accept: text/event-stream (SSE-framed reply).
// - GET   /api/mcp   Accept: text/event-stream -> keepalive SSE stream (no server msgs).
//                    otherwise -> plain metadata JSON for humans/curl.
//
// Free tools run inline. search_web and scrape_url are PAID: they return only the x402 payment resource
// (endpoint, price, how to pay) and never run the search or the fetch — the same code path is sold at
// /api/search and /api/scrape, so running it here for free would undercut both. Free results whose paid
// HTTP counterpart adds real capability carry an `upgrade` field: endpoint, price, what it adds.
import { NextRequest } from "next/server";
import { BASE, PAY_TO, SUPPORTED_PROTOCOLS, LATEST_PROTOCOL, SERVER_INFO, TOOLS, PAID_TOOLS } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, Mcp-Session-Id",
};

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
          "Wallet and address tools for agents, no key or account. Free tools run inline: lookup_wallet, resolve_name, check_entity, caller_id, health. search_web and scrape_url are paid ($0.01 USDC on Base via x402): they return the payment resource to call, not the result. Free results whose paid HTTP counterpart adds capability carry an `upgrade` field.",
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
    free_tools: TOOLS.map((t) => t.name).filter((n) => !PAID_TOOLS.includes(n)),
    paid_tools: PAID_TOOLS,
    note: "Free tools run inline. Paid tools (search_web, scrape_url) return their x402 payment resource, $0.01 USDC on Base; the other paid HTTP endpoints (risk, llm, extract, embed) are in /.well-known/x402.json.",
    payment: { protocol: "x402", network: "base", asset: "USDC", pay_to: PAY_TO },
  });
}
