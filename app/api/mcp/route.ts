// app/api/mcp/route.ts â€” CryptoRisk MCP server (Streamable HTTP, zero-dependency)
//
// Exposes CryptoRisk as agent-callable MCP tools so ANY MCP-capable agent
// (Claude, Cursor, etc.) can DISCOVER and CALL it automatically. Implements the
// MCP Streamable HTTP transport by hand (JSON-RPC 2.0) â€” no SDK, no new deps,
// nothing to break the build.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://cryptorisk-api.vercel.app";
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cryptorisk", version: "1.0.0" };

const TOOLS = [
  {
    name: "check_live_risk",
    description:
      "Before buying or holding ANY Base or Ethereum token, call this to check whether the token's OWNER can turn it hostile WHILE YOU HOLD â€” swap the contract logic (upgradeable proxy), pause/block sells, or exploit un-renounced ownership. Unlike honeypot scanners that only report the CURRENT state, this checks whether the token can BECOME a trap in a future block. Returns a verdict from SAFE_TO_HOLD to DO_NOT_HOLD, a mutable_risk_score (0-100), time_to_rug, and the exact owner powers.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "The 0x EVM token contract address." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Chain (default: base)." },
      },
      required: ["address"],
    },
  },
  {
    name: "check_token_risk",
    description:
      "Get an overall risk score (0-100), verdict (PROCEED/CAUTION/BLOCK), and risk flags for a Base or Ethereum wallet or token address. General safety read.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "The 0x EVM address (wallet or token)." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Chain (default: base)." },
      },
      required: ["address"],
    },
  },
  {
    name: "list_new_launches",
    description:
      "List the NEWEST DEX token pairs on Base or Ethereum (fresh launches) with liquidity, age, and risk flags. Use to find new tokens the moment they appear. Each result includes the token address so you can then call check_live_risk on it.",
    inputSchema: {
      type: "object",
      properties: {
        chain: { type: "string", enum: ["base", "ethereum"], description: "Chain (default: base)." },
        limit: { type: "number", description: "Max results, 1-30 (default 15)." },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const chain = args.chain === "ethereum" ? "ethereum" : "base";
  if (name === "check_live_risk") {
    const r = await fetch(`${BASE}/api/risk/live?address=${encodeURIComponent(String(args.address ?? ""))}&chain=${chain}`);
    return await r.text();
  }
  if (name === "check_token_risk") {
    const r = await fetch(`${BASE}/api/risk?address=${encodeURIComponent(String(args.address ?? ""))}&chain=${chain}`);
    return await r.text();
  }
  if (name === "list_new_launches") {
    const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 30);
    const r = await fetch(`${BASE}/api/launches?chain=${chain}&limit=${limit}`);
    return await r.text();
  }
  throw new Error(`Unknown tool: ${name}`);
}

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: cors() });
}

interface RpcMsg { id?: unknown; method?: string; params?: Record<string, unknown> }

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { headers: cors() });
  }

  const single = !Array.isArray(body);
  const messages: RpcMsg[] = (single ? [body] : body) as RpcMsg[];
  const responses: unknown[] = [];

  for (const msg of messages) {
    const id = msg?.id;
    const method = msg?.method;
    const params = msg?.params ?? {};
    const isNotification = id === undefined || id === null;

    if (method === "initialize") {
      const clientVersion = params.protocolVersion;
      responses.push({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: typeof clientVersion === "string" ? clientVersion : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        },
      });
    } else if (method === "notifications/initialized" || method === "notifications/cancelled") {
      // notification: no response
    } else if (method === "ping") {
      responses.push({ jsonrpc: "2.0", id, result: {} });
    } else if (method === "tools/list") {
      responses.push({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await callTool(name, args);
        responses.push({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (e) {
        responses.push({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : "tool failed"}` }], isError: true } });
      }
    } else if (!isNotification) {
      responses.push({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }

  if (responses.length === 0) return new NextResponse(null, { status: 202, headers: cors() });
  return NextResponse.json(single ? responses[0] : responses, { headers: cors() });
}
