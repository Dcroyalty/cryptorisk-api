# Running unattended — what needs a human, and when

uxus.finance is built to run without anyone watching it. This page lists every
date or event a human must act on, what breaks if it's missed, and how you'll
hear about it. Last reviewed 2026-09-30.

## How you'll find out something is wrong

| Signal | What it covers | Needs |
|---|---|---|
| **Watchdog message** (daily 08:00 UTC) on `ERROR_WEBHOOK_URL` | Every check below that says "watchdog". One consolidated message when anything is `warn` or `FAIL`; a short "all green" check-in every Monday. | `ERROR_WEBHOOK_URL` = a Discord or Slack incoming-webhook URL |
| **healthchecks.io email** | The crons stopped, Vercel is down, the DB is down, or the webhook is broken. The watchdog is the only success pinger; refresh-lists pings `/fail` on its own failure. | `HEALTHCHECK_PING_URL` = the check's ping URL. Period **1 day**, grace **3 hours**. |
| Vercel "cron failed" email | Either cron route returned 500 | Vercel account notifications on |

**If the Monday "all green" message stops arriving, something is broken even if nothing alerted.**

## Scheduled jobs (`vercel.json`)

| UTC | Route | Does |
|---|---|---|
| 06:00 | `/api/cron/refresh-lists` | OFAC full sync (guarded: aborts below 50 addresses) + ScamSniffer/MEW append, then the Shield 90-day retention sweep. Heartbeats in `cron_runs`. |
| 08:00 | `/api/cron/watchdog` | Grades everything below. `?dry=1` (with the cron bearer) runs checks without alerting. |

Both require `CRON_SECRET` (set). Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://uxus.finance/api/cron/watchdog?dry=1`.

## Dated items

| Date | Item | What breaks if missed | Watched? |
|---|---|---|---|
| **2027-03-30** | `uxus.finance` domain registration expires (registered 2026-03-30) | Entire site, API, MCP, x402 resource URLs — every Bazaar / directory listing points at a dead domain | Watchdog: warn at 45 days, FAIL at 14. **Turn on auto-renew at the registrar now.** |
| 1st of each month | Neon free-plan compute quota resets (project `cryptorisk`, `quiet-resonance-38570244`) | If the monthly compute allowance is exhausted, the DB suspends: sanctions lookups degrade, Shield and API keys stop | Storage is watched (512 MB cap, warn 70%, FAIL 90%). Compute hours are not — check the Neon console monthly for the first few months. |
| Stripe `current_deadline` (none today) | Stripe asks for more business verification | Card subscriptions stop charging / payouts pause | Watchdog: warn with the deadline date; FAIL if `charges_enabled` goes false |

## Things that run out (no fixed date)

| Item | Breaks | Watched? |
|---|---|---|
| **OpenRouter credit** | `/api/llm`, `/api/extract` error **after the buyer's USDC has settled** (x402 v1 settles before the route runs) | Watchdog: warn < $2, FAIL < $0.25 |
| **Serper credit** (purchased credits can expire — check the expiry shown on the Serper dashboard) | `/api/search` falls back to non-Google providers (structured blocks go empty); the Apify search actor's Google results stop | Watchdog: warn < 500, FAIL < 50 |
| Jina embeddings quota | `/api/embed` errors after settlement | **Not watched** (no balance API). Check the Jina dashboard monthly. |
| Neon storage (512 MB) | Writes fail | Watchdog |
| Blockscout keyless rate limit (10 req/window/IP) | Under a traffic burst, EVM lookups return `degraded` / CAUTION (never a false PROCEED) | Mitigated by 429 retry; **fixed by adding `BLOCKSCOUT_API_KEY`** (free, dev.blockscout.com) |

## Upstreams that can die

| Upstream | Breaks | Watched? |
|---|---|---|
| OFAC list feed (`0xB10C/ofac-sanctioned-digital-currency-addresses`, community-run) | New sanctions designations stop reaching us | Watchdog: exact DB↔feed parity daily; warn if the feed hasn't committed in 60 days (normal cadence 2–3 weeks) |
| CDP x402 facilitator | Paid calls can't verify/settle | Watchdog FAIL. Customers get a **503 + Retry-After + "you were not charged"** and pointers to free equivalents / API keys, never a bare 402. |
| Stripe API | New card subscriptions | Checkout returns a clear 503 pointing at x402 pay-per-call; the success page keeps polling for ~3 min and gives the customer a support reference. Existing API keys keep working (quota is in our DB, not Stripe). |
| XRPL public nodes | `/api/lookup` for r-addresses | Node pool of 8 with lag/amendment-block cooling (floor of 3). No ledger majority → 503 `xrpl_no_consensus`. Watchdog warns on bad nodes, FAILs on no majority. |
| Apify actors | Store listings go "Under maintenance" if Apify's daily QA run fails | Watchdog reads each actor's public page + API daily |

## Credentials

| Secret | Expires? | If it stops working |
|---|---|---|
| `CDP_API_KEY_ID` / `_SECRET` | Only if an expiry was set when created — check portal.cdp.coinbase.com → API keys | All x402 payments fail → watchdog FAIL on `pay:cdp-facilitator` |
| `STRIPE_SECRET_KEY` | Restricted keys can carry an expiry | Watchdog FAIL on `pay:stripe-account` |
| `OPENROUTER_API_KEY`, `SERPER_API_KEY`, `JINA_API_KEY` | No | Watchdog (OpenRouter, Serper) |
| `CRON_SECRET` | No | Crons 401 → both heartbeats go stale → healthchecks.io emails |

## Not automated, on purpose

- **x402 v1 → v2 migration.** Pinned to `x402-next@1.2.0`. When CDP announces a v1 sunset, that's a
  deliberate upgrade (also what Polygon/Arbitrum need). The watchdog's `pay:cdp-facilitator` check
  fails the day CDP stops listing v1 `exact` on `base`.
- **Refunds.** A buyer charged for a call whose upstream then failed is refunded by hand (see `/refunds`).

## Vercel plan

The Hobby plan's terms don't permit commercial use. If the project is on Hobby, move it to Pro
before revenue matters — it also lifts the once-a-day cron limit and log retention.
