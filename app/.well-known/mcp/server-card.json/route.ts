// app/.well-known/mcp/server-card.json — MCP Server Card (Smithery's documented shape).
// Served so scanners (Smithery and others) read the CURRENT tool set instead of a one-time crawl.
// Built from the same TOOLS array the JSON-RPC endpoint uses, so it can never drift.
import { NextResponse } from "next/server";
import { BASE, LATEST_PROTOCOL, SERVER_INFO, SERVER_DESCRIPTION, TOOLS } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(
    {
      $schema: "https://modelcontextprotocol.io/schemas/draft/2025-06-18/server-card.json",
      version: "1.0",
      protocolVersion: LATEST_PROTOCOL,
      serverInfo: {
        name: SERVER_INFO.name,
        title: SERVER_INFO.title,
        version: SERVER_INFO.version,
        description: SERVER_DESCRIPTION,
        websiteUrl: BASE,
      },
      transport: { type: "streamable-http", url: `${BASE}/api/mcp` },
      authentication: { required: false },
      capabilities: { tools: {} },
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      resources: [],
      prompts: [],
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
