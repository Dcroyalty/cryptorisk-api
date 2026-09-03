# uxus-mcp

Zero-config MCP server for **UXUS Agent Services**. Free web search, page scraping,
universal wallet lookup, ENS/Basename resolution, entity attribution, and wallet
caller ID — **no API key, no account, no signup**.

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
| `search_web` | Live web search → ranked `{ title, url, description, score }` results. |
| `scrape_url` | Fetch any URL → clean markdown / text / html, past common bot-blocking. |
| `lookup_wallet` | Any address, any chain (EVM + XRPL, auto-detected) → one normalized risk + entity envelope. |
| `resolve_name` | ENS / Basename ↔ address, bidirectional, reverse records forward-verified. |
| `check_entity` | What *is* this address — sanctioned, mixer, exchange, scam, drainer, protocol… |
| `caller_id` | Should this wallet be answered? `ANSWER \| SCREEN \| BLOCK` with reasons. |
| `health` | Upstream reachability check. |

Every tool is free. Where a paid HTTP endpoint adds capability (deeper risk
signals, batch, direct settlement), the result carries an `upgrade` field with
the endpoint, price, and what it adds. A funnel, not a paywall — see
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
