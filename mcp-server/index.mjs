#!/usr/bin/env node
// uxus-mcp — zero-config stdio MCP server for UXUS Agent Services.
//
//   npx uxus-mcp
//
// No API key, no account, no config. It is a thin stdio <-> HTTP bridge: the
// local stdio server handshakes with your MCP client, and forwards tools/list,
// tools/call, resources/list and resources/read to https://uxus.finance/api/mcp
// (override with UXUS_MCP_ENDPOINT). All tools are free; results whose paid HTTP
// counterpart adds capability carry an `upgrade` field.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const ENDPOINT = process.env.UXUS_MCP_ENDPOINT || "https://uxus.finance/api/mcp";
const PROTOCOL_VERSION = "2025-06-18";

let seq = 0;
async function rpc(method, params) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "user-agent": "uxus-mcp/1.0.0",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    const e = new Error(body.error.message || `${method} failed`);
    e.code = body.error.code;
    throw e;
  }
  return body.result;
}

const server = new Server(
  { name: "uxus-agent-services", version: "1.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => rpc("tools/list"));
server.setRequestHandler(CallToolRequestSchema, (req) => rpc("tools/call", req.params));
server.setRequestHandler(ListResourcesRequestSchema, () => rpc("resources/list"));
server.setRequestHandler(ListResourceTemplatesRequestSchema, () => rpc("resources/templates/list"));
server.setRequestHandler(ReadResourceRequestSchema, (req) => rpc("resources/read", req.params));
server.setRequestHandler(ListPromptsRequestSchema, () => rpc("prompts/list"));

const transport = new StdioServerTransport();
// Exit cleanly when the client disconnects. The SDK transport fires onclose
// after draining buffered messages, so this does not race an in-flight request.
transport.onclose = () => process.exit(0);
await server.connect(transport);
process.stderr.write(`uxus-mcp ready — proxying to ${ENDPOINT}\n`);
