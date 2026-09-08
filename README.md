# UXUS — Agent Services

Pay-per-call primitives for AI agents, live at **[uxus.finance](https://uxus.finance)**.
Paid in USDC on Base via the [x402](https://x402.org) protocol — no accounts, no API
keys, no signup. A funded wallet is the whole integration.

## Services

| Endpoint | Price | What you get |
|---|---|---|
| `POST /api/llm` | $0.01 | LLM completion, 5-model fallback chain |
| `GET /api/scrape` | $0.01 | URL → clean markdown/text/html |
| `POST /api/extract` | $0.01 | messy text/URL → JSON in your schema |
| `POST /api/embed` | $0.01 | text → 1024-dim vectors (jina-embeddings-v3) |
| `GET /api/search` | $0.01 | live web search |
| `GET /api/risk/pro` | $0.01 | full wallet/token risk report |
| `GET /api/risk/live/pro` | $0.01 | mutable-risk report — can the owner still turn a token hostile? |
| `GET /api/risk` · `/api/risk/live` | free | risk score + verdict (no reasons/signals) |
| `GET /api/lookup` | free | universal address lookup, EVM + XRPL, chain auto-detected |
| `GET /api/entity` | free | entity attribution — what *is* this address |
| `GET /api/resolve` | free | ENS / Basenames, forward + reverse (forward-verified) |
| `GET /api/callerid` | free | should this wallet be answered? (for XMTP/Push) |
| `/api/shield/*` | free | per-user private wallet blocklist (signature-auth) |
| `GET /api/catalog` · `/openapi.json` · `/llms.txt` · `/.well-known/x402.json` | free | discovery |
| `POST /api/mcp` | free | MCP server (Streamable HTTP) over the free tools |

Every risk/verdict response carries a `disclaimer`: this is developer-grade
screening from public data (OFAC SDN list, community scam registries, on-chain
reads), not legal or compliance advice.

## Data

- **Sanctions** come from one place: the OFAC SDN list in `bad_addresses`
  (`source='ofac'`), refreshed **daily** by `/api/cron/refresh-lists` (guarded — a
  0-address upstream response aborts rather than wiping the table). `lib/entity.ts`
  is the only place that joins it. A non-OFAC blocklist hit is category `flagged`,
  not `sanctioned`, and is allowlistable.
- **Scoring fails open**: if a data source needed for a verdict is unavailable and
  there's no list hit, the response is `degraded:true` / verdict `CAUTION`, never
  `PROCEED`.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
```

Env (Vercel project settings):

| var | required | purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon Postgres |
| `CRON_SECRET` | yes | gates `/api/cron/*`; Vercel Cron sends it as `Authorization: Bearer` |
| `OPENROUTER_API_KEY` | for `/api/llm`, `/api/extract` | |
| `JINA_API_KEY` | for `/api/embed` | |
| `SERPER_API_KEY` / `BRAVE_API_KEY` | optional | `/api/search` (falls back to DuckDuckGo) |
| `ETHERSCAN_API_KEY` | optional | wallet history (falls back to Blockscout) |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | for x402 settlement | |

Scripts: `scripts/schema*.mjs` (create tables), `scripts/ingest*.mjs` (manual list
load — the scheduled path is `lib/refresh-lists.ts` + `scripts/ingest-entity.mjs`),
`scripts/shield-verify.mjs` (live E2E), `scripts/fix-sanctions.mjs` (one-shot
sanctions remediation, already run).
