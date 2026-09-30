# Running unattended — what needs a human, and when

uxus.finance is built to run without anyone watching it. This page lists every
date or event a human must act on, what breaks if it's missed, and how you'll
hear about it. Last reviewed 2026-09-30.

## How you'll find out something is wrong

**healthchecks.io is the only alert channel.** There is no webhook (`ERROR_WEBHOOK_URL` is deliberately unset).

| Signal | What it covers | Needs |
|---|---|---|
| **healthchecks.io "down" email** after a `/fail` ping | Any RED watchdog check (daily 08:00 UTC), or the 06:00 list refresh / Shield sweep failing. The email includes the ping body: a plain-text list of every RED check (and any warnings) with the reason. | `HEALTHCHECK_PING_URL` = the check's ping URL. Period **1 day**, grace **3 hours**. |
| **healthchecks.io "down" email** after missed pings | The watchdog stopped running, both crons stopped, Vercel or the DB is down. The watchdog is the only success pinger. | same |
| Vercel "cron failed" email | Either cron route returned 500 | Vercel account notifications on |

Warnings (e.g. a credit balance getting low) do **not** email you: they appear in the ping body on healthchecks.io and in the `cron_runs` table. Glance at the check's last ping once a week.

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
| Blockscout keyless rate limit (10 req/window/IP) | Under a traffic burst, EVM lookups return `degraded` / CAUTION (never a false PROCEED) | Keyless instance first (every Vercel IP has its own allowance), then — once an IP is rate-limited — the **Blockscout PRO API** with `BLOCKSCOUT_API_KEY` (a `proapi_…` key from dev.blockscout.com; free plan 5 req/s, 100K credits/day, all chains). A non-`proapi_` value is treated as a base.blockscout.com instance key instead. Circuit breaker stops calls to a locked-out host. |

## Upstreams that can die

| Upstream | Breaks | Watched? |
|---|---|---|
| OFAC list feed (`0xB10C/ofac-sanctioned-digital-currency-addresses`, community-run) | New sanctions designations stop reaching us | Watchdog: exact DB↔feed parity daily; warn if the feed hasn't committed in 60 days (normal cadence 2–3 weeks) |
| CDP x402 facilitator | Paid calls can't verify/settle | Watchdog FAIL. Customers get a **503 + Retry-After + "you were not charged"** and pointers to free equivalents / API keys, never a bare 402. |
| Stripe API | New card subscriptions | Checkout returns a clear 503 pointing at x402 pay-per-call; the success page keeps polling for ~3 min and gives the customer a support reference. Existing API keys keep working (quota is in our DB, not Stripe). |
| XRPL public nodes | `/api/lookup` for r-addresses | Node pool of 8 with lag/amendment-block cooling (floor of 3). No ledger majority → 503 `xrpl_no_consensus`. Watchdog warns on bad nodes, FAILs on no majority. |
| Apify actors | Store listings go "Under maintenance" if Apify's daily QA run fails | Watchdog reads each actor's public page + API daily |

## Multi-rail payments (x402 v2: Base + Polygon + Solana)

`/api/v2/*` are twins of the seven paid routes that accept USDC on Base, Polygon or Solana through the CDP
facilitator (x402 v2). They never touch the v1 Base routes: the v1 routes, `middleware.ts` and their CDP
Bazaar records are unchanged. v2 settles **after** the handler succeeds, so a buyer is never charged for an error.

- **Flag** `X402_MULTIRAIL`: unset/`off` (default) → every `/api/v2/*` request 307-redirects to its v1 Base twin;
  `test` → live only for requests with `x-uxus-rail-test: $X402_MULTIRAIL_TEST_TOKEN`; `on` → live for everyone.
  Env changes need a redeploy.
- **Kill switch**: 3 infrastructure errors (facilitator down, rail validation against CDP `/supported` failing,
  settlement unavailable) within 10 minutes trips it → every instance falls back to v1 Base, and the watchdog
  goes RED (`x402v2:rails`, healthchecks.io emails you). It stays off until you clear it after fixing the cause:
  `UPDATE x402_rail_state SET tripped_at = NULL, reason = NULL;`
- **Solana** is offered only when `X402_SOLANA_PAY_TO` is set. That address must already hold a USDC token
  account (it must have received USDC once) — x402 Solana transfers cannot create one.
- **Test a rail for real** (spends $0.01): `node scripts/test-multirail.mjs polygon|solana|base`.

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
