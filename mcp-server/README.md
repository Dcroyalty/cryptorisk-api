# uxus-mcp

Zero-config MCP server for **UXUS Agent Services**. Free universal wallet lookup,
ENS/Basename resolution, entity attribution, and wallet caller ID. Web search and
page scraping are paid ($0.01 USDC on Base via x402): those two tools return the
payment resource to call. **No API key, no account, no signup.**

## Install

Nothing to install. Point your MCP client at:

```json
{
  "mcpServers": {
    "uxus": {
      "command": "npx",
      "args": ["-y", "uxus-mcp"]
    }
  }
}
```

That's the whole setup. No environment variables, no keys.

Prefer a remote connection? The same server is live over Streamable HTTP at
`https://uxus.finance/api/mcp` — use it directly with any MCP client that
supports remote servers.

## Tools

| Tool | What it does |
|------|--------------|
| `search_web` | **Paid** ($0.01 USDC on Base, x402). Returns the payment resource for a live web search; does not run it. |
| `scrape_url` | **Paid** ($0.01 USDC on Base, x402). Returns the payment resource for URL → clean markdown / text / html; does not fetch it. |
| `lookup_wallet` | Any address, any chain (EVM + XRPL, auto-detected) → one normalized risk + entity envelope. |
| `resolve_name` | ENS / Basename ↔ address, bidirectional, reverse records forward-verified. |
| `check_entity` | What *is* this address — sanctioned, mixer, exchange, scam, drainer, protocol… |
| `caller_id` | Should this wallet be answered? `ANSWER \| SCREEN \| BLOCK` with reasons. |
| `health` | Upstream reachability check. |

`search_web` and `scrape_url` are paid: they return `{ paid, resource, method, price, pay_to, how }`
and never run the search or the fetch. Every other tool is free. Where a paid HTTP
endpoint adds capability to a free result (deeper risk signals), the result carries an
`upgrade` field with the endpoint, price, and what it adds. See
<https://uxus.finance/.well-known/x402.json>.

## Resources

`openapi.json`, `llms.txt`, and the x402 discovery manifest are exposed as MCP
resources.

## How it works

`uxus-mcp` is a thin stdio ↔ HTTP bridge: your client talks stdio to a local
server, which forwards `tools/*` and `resources/*` to `https://uxus.finance/api/mcp`.
Override the target with `UXUS_MCP_ENDPOINT`.

## License

MIT
