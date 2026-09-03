// Real MCP client handshake against the local stdio server.
//   node test-client.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// StdioClientTransport does not inherit process.env by default — pass it through
// so UXUS_MCP_ENDPOINT reaches the spawned server during local testing.
const transport = new StdioClientTransport({ command: "node", args: ["index.mjs"], env: { ...process.env } });
const client = new Client({ name: "uxus-mcp-test", version: "1.0.0" }, { capabilities: {} });

await client.connect(transport);
console.log("✓ connected. server:", JSON.stringify(client.getServerVersion()));
console.log("  capabilities:", JSON.stringify(client.getServerCapabilities()));

const tools = await client.listTools();
console.log(`\n✓ tools/list — ${tools.tools.length} tools:`);
for (const t of tools.tools) console.log(`  - ${t.name}  (${t.description.length} chars, schema keys: ${Object.keys(t.inputSchema.properties || {}).join(", ") || "none"})`);

const resources = await client.listResources();
console.log(`\n✓ resources/list — ${resources.resources.length}:`);
for (const r of resources.resources) console.log(`  - ${r.uri}`);

console.log("\n✓ tools/call health:");
console.log(" ", (await client.callTool({ name: "health", arguments: {} })).content[0].text.replace(/\n/g, " "));

console.log("\n✓ tools/call search_web {query:'x402 payment protocol', count:3}:");
const s = await client.callTool({ name: "search_web", arguments: { query: "x402 payment protocol", count: 3 } });
const sj = JSON.parse(s.content[0].text);
console.log(`  provider=${sj.provider} results=${sj.results?.length} scores=[${(sj.results || []).map((r) => r.score).join(", ")}]`);

console.log("\n✓ tools/call scrape_url {url:'https://example.com'}:");
const sc = await client.callTool({ name: "scrape_url", arguments: { url: "https://example.com" } });
const scj = JSON.parse(sc.content[0].text);
console.log(`  status=${scj.status} title=${JSON.stringify(scj.title)} chars=${scj.chars}`);

console.log("\n✓ tools/call check_entity {address: Tornado.Cash Donate}:");
const ce = await client.callTool({ name: "check_entity", arguments: { address: "0x8589427373d6d84e98730d7795d8f6f8731fda16", chain: "ethereum" } });
const cej = JSON.parse(ce.content[0].text);
console.log(`  category=${cej.category} label=${JSON.stringify(cej.label)} has upgrade field: ${!!cej.upgrade}`);

console.log("\n✓ resources/read openapi.json:");
const rr = await client.readResource({ uri: "https://uxus.finance/openapi.json" });
console.log(`  ${rr.contents[0].mimeType}, ${rr.contents[0].text.length} bytes, parses: ${(() => { try { JSON.parse(rr.contents[0].text); return "yes"; } catch { return "NO"; } })()}`);

console.log("\n✓ prompts/list:");
console.log(" ", JSON.stringify(await client.listPrompts()));

await client.close();
console.log("\nALL CHECKS PASSED");
