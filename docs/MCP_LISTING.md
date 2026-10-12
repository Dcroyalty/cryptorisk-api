# mcp.so listing — UXUS Agent Services

The canonical text for our MCP directory listing. It describes MCP server **v1.2.0** (`app/api/mcp/route.ts`,
commit `1a004c4`, 2026-10-12). When a tool is added, removed, renamed, or changes between free and paid, update
this file in the same commit and resubmit the text to mcp.so.

Submit at <https://mcp.so/submit> (sign-in required). GitHub issues on `chatmcp/mcpso` are not processed.

| Field | Value |
|---|---|
| Name | UXUS Agent Services |
| URL | `https://uxus.finance/api/mcp` |
| Transport | Streamable HTTP (MCP 2025-06-18), stateless, no API key or account |
| Repository | `https://github.com/Dcroyalty/cryptorisk-api` |
| Website | `https://uxus.finance` |
| Contact | `support@uxus.finance` |

## Description

```
Wallet and address tools for AI agents over Streamable HTTP, no API key or account. Free tools: universal wallet lookup (EVM and XRPL) with a first-pass risk verdict, ENS and Basename resolution, entity labels for an address (exchange, bridge, mixer, sanctioned, scam and more), and a wallet caller-ID check that answers ANSWER, SCREEN or BLOCK. Paid tools: search_web and scrape_url cost $0.01 USDC on Base via x402; each returns the payment resource to call, and your agent pays from its own wallet. The same origin sells one-call wallet and token risk verdicts (PROCEED, CAUTION or BLOCK with reasons) at $0.02 over plain HTTP.

Tools: lookup_wallet, resolve_name, check_entity, caller_id, health (free); search_web, scrape_url (paid, x402).
```

## Tools

| Tool | Free or paid | What it does |
|---|---|---|
| `lookup_wallet` | free | Any EVM or XRPL address: exists, risk score and verdict, flags, entity, name. |
| `resolve_name` | free | ENS and Basename name ↔ address, reverse records forward-verified. |
| `check_entity` | free | What an EVM address is: exchange, bridge, mixer, sanctioned, scam, and so on. |
| `caller_id` | free | Should this wallet be answered: ANSWER, SCREEN or BLOCK, with reasons. |
| `health` | free | Service reachability check. |
| `search_web` | paid, $0.01 USDC on Base (x402) | Returns the payment resource for `GET /api/search`. Does not run the search. |
| `scrape_url` | paid, $0.01 USDC on Base (x402) | Returns the payment resource for `GET /api/scrape`. Does not fetch the page. |

Rule: an MCP tool never gives away what an x402 endpoint sells. A paid tool returns
`{ paid, resource, method, price, pay_to, how, returns, discovery }` and nothing else.
