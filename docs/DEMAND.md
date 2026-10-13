# Demand diagnosis — 13 October 2026

Evidence only. Every number below was read on 2026-10-13 from a public source or our own
accounts; where something could not be read, it says so.

## Bottom line

- Nothing we sell today has a paying outside customer who came back. 30 days of x402: **$0.18**
  from two one-off wallets. Apify: **no confirmed outside user** on either actor.
- Sanctions and compliance screening has almost no buyers on either marketplace. The most-used
  sanctions actor on Apify has 53 users in total and 3 this month. The only x402 sanctions endpoint
  with traffic had 66 calls from 3 payers.
- What people do pay for, repeatedly, is **token data and token verdicts for traders**: one x402
  endpoint (ax1.vc) took an estimated $7,500 in 30 days at $0.02 a call, and the busiest crypto
  actors on Apify are DexScreener token scrapers.
- **Recommendation:** one new Apify actor — new and trending EVM tokens from DexScreener, each with
  our "can the owner still rug this" verdict. It is a bet, not a sure thing; the reasoning and the
  ceiling are in the last section.

## 1. Our numbers (last 30 days)

### Apify

| Actor | Price charged | Total users | Users, 30 days | Runs, 30 days | Runs that were ours |
|---|---|---|---|---|---|
| wallet-sanctions-risk-screener | $0.025 per address | 2 | 1 | 20 (0 failed) | 5 |
| google-search-serp-scraper | $0.01 per query | 2 | 1 | 19 (0 failed) | 3 |

- The other ~15 runs per actor arrive about once a day at a fixed hour. That pattern fits Apify's
  automated daily test of public actors, not a customer. **Not confirmed** — the API does not say
  who ran them.
- **Earnings: not readable through the API.** Apify Console → the actor → Insights shows paid
  events and payout. If the daily runs are Apify's tests, earnings are $0.
- No reviews, no bookmarks, no issues on either actor.

### x402 (USDC into our wallet on Base, 13 Sep – 13 Oct)

48 transfers, $0.56 in total. Split by who sent them:

| Sender type | Wallets | Calls | USD | How it was classified |
|---|---|---|---|---|
| Our own test wallet | 1 | 6 | $0.08 | known address |
| Bridge funding (LI.FI) | 1 | 1 | $0.07 | known contract, not a sale |
| Marketplace crawlers | 3 | 23 | $0.23 | each paid 36–929 different recipients within ~3 hours |
| **Outside, not a crawler** | **2** | **18** | **$0.18** | 3–7 recipients in the same window |

- The two real outside wallets: one made 17 calls in a single day (17 Sep) and never returned; the
  other made 1 call. **Repeat customers: zero.**
- Coinbase's Bazaar index agrees: our 7 listed endpoints total 44 calls in 30 days, at most 3
  payers each (`/api/search` 19, `/api/extract` 11, both risk routes 3 each).
- Stripe subscriptions: checkout is live, 0 subscribers.

## 2. Where the demand is

### Apify — crypto, compliance and sanctions actors, by users

Searched 20 terms in the public store listing, 324 relevant actors. "Monthly" is users in the last
30 days.

**Crypto (the top of the category):**

| Actor | What it does | Price | Total users | Monthly | Rating |
|---|---|---|---|---|---|
| dataraptor/crypto-arbitrage-scanner | Price gaps across exchanges | from $0.001 per start + $0.001 per result | 750 | 15 | 3.3 (2) |
| crypto-scraper/dexscreener-tokens-scraper | DexScreener token data | $0.01 per start + $0.0015 per token | 748 | 21 | 5.0 (4) |
| muhammetakkurtt/dexscreener-scraper | DexScreener token data | from $1.00 per 1,000 tokens | 658 | 23 | 5.0 (6) |
| muhammetakkurtt/gmgn-wallet-stat-scraper | Trader wallet stats from GMGN | from $5.00 per 1,000 wallets | 437 | 4 | 5.0 (3) |
| muhammetakkurtt/gmgn-copytrade-wallet-scraper | Profitable wallets to copy | not shown | 334 | 18 | 5.0 (3) |
| louisdeconinck/coinmarketcap-crypto-scraper | CoinMarketCap listings | $1.80 per 1,000 | 322 | 4 | 5.0 (2) |
| muhammetakkurtt/crypto-wallet-data-scraper | Wallet portfolio, P&L, entity labels | from $1.00 per 1,000 | 281 | 14 | 4.4 (2) |
| muhammetakkurtt/pump-fun-token-scraper-monitor | New pump.fun tokens | not shown | 226 | 4 | 5.0 (4) |

**Compliance and sanctions (everything with more than a handful of users):**

| Actor | What it does | Price | Total users | Monthly | Rating |
|---|---|---|---|---|---|
| ryanclinton/opensanctions-search | Names vs OFAC, EU, UN, UK, PEP lists | $3.00 per 1,000 | 53 | 3 | none |
| brasildados/sanctions-check | Brazilian federal registries | $0.10 per start + $0.01 per result | 43 | 4 | 5.0 (1) |
| pink_comic/ofac-sanctions-screening | Names vs OFAC SDN | $2.00 per 1,000 | 9 | 2 | none |
| george.the.developer/ofac-sanctions-screener | Names vs OFAC SDN | $0.01 per entity | 7 | 0 | none |
| inexhaustible_glass/sanctions-screener | OFAC, UN, EU, UK | $0.02 per start + $0.005 per result | 5 | 1 | none |

What this shows:

- Every crypto actor with real usage sells **trader data** — new tokens, prices, who is buying.
  None sells compliance.
- The whole category is small. The busiest crypto actor has 23 users a month.
- Sanctions screening on Apify is name screening, priced $2–10 per 1,000, with single-digit
  monthly users. Ours is priced at $25 per 1,000 for wallet screening that nobody else's listing
  shows demand for.

**Reviewer complaints: could not be read.** Apify loads review text in the browser only; the
public API and the page source carry the star rating and count but not the text. The only
below-4.5 ratings in the set are the arbitrage scanner (3.3 from 2 reviews, 96.4% of runs
succeed against 99.9–100% for the others) and the wallet-data scraper (4.4 from 2). To read the
words, open each actor's Reviews and Issues tabs.

### x402 — endpoints with repeat payers that are not crawlers

From Coinbase's Bazaar index: 33,487 listed resources. "Est. revenue" is calls × lowest listed
price, so it is an estimate, and it is wrong for listings whose price is a maximum (Bitrefill and
other "$1,000" entries are excluded for that reason).

| Endpoint | What it sells | Price | Calls, 30 d | Payers | Calls per payer | Est. revenue |
|---|---|---|---|---|---|---|
| ax1.vc token verdict | Base token address → written verdict | $0.02 | 376,049 | 3,501 | 107 | $7,521 |
| keyring-agent send-token / send-native | Executes a transfer for an agent | $0.05 | 26,955 | 58 | 233 | $1,348 |
| sniperx smart-money activity | Smart-trader activity on a token | $0.02 | 22,934 | 17 | 1,349 | $459 |
| stableenrich people-enrich | Person lookup (career, email) | $0.28 | 1,001 | 46 | 22 | $280 |
| stableenrich Exa search | Web search | $0.01 | 21,160 | 166 | 128 | $212 |
| blockrun chat completions | LLM calls | $0.002 | 74,767 | 249 | 300 | $150 |
| Arkham address intelligence | Who owns an address | $0.20 | 200 | 18 | 11 | $40 |

Risk and sanctions endpoints on the same index:

| Endpoint | Price | Calls, 30 d | Payers |
|---|---|---|---|
| deepnets token-safety (Solana) | $0.01 | 891 | 6 |
| solenrich new tokens, safest first | $0.012 | 647 | 5 |
| x402node honeypot check | $0.01 | 116 | 22 |
| losbeto OFAC sanctions | $0.05 | 66 | 3 |
| **ours: /api/risk/pro and /api/risk/live/pro** | $0.02 | 3 each | 3 each |

What this shows:

- One product dominates: a **token verdict at $0.02**. It is the same price and the same shape as
  our `/api/risk/live/pro`, which got 3 calls.
- The difference is distribution, not the product. ax1 puts its endpoint inside its own console,
  partner apps and paid quests. How much of its 107 calls per payer is rewarded activity rather
  than organic use is **not known**.
- Sanctions screening has no measurable x402 demand.

## 3. The one recommendation

**Build one Apify actor: new and trending tokens on Base, Ethereum and BSC from DexScreener, each
row carrying our live contract-control verdict** (owner can pause, owner can swap the logic,
ownership renounced or not, PROCEED / CAUTION / BLOCK).

Why this one:

- It is the only place where two things we measured overlap: buyers who already pay for token
  feeds (the two DexScreener actors, 1,406 users between them and 44 this month), and the one
  thing we have that those feeds lack. Both incumbents return price, liquidity and volume and
  nothing about what the owner can do.
- The control-risk reads already exist in `lib/live-risk.ts` and run in the wallet actor, so this
  is packaging, not new research.
- The x402 side shows the same pairing gets repeat use when it exists: "new tokens, safest first"
  and "token safety" endpoints have 129–148 calls per payer, from very few payers (5–6 each).

Why it might not win:

- The incumbents are rated 5.0 with 99.9–100% success. There are no visible complaints to
  exploit; we would be adding a column, not fixing a failure.
- Most trader demand in this category is Solana (pump.fun, GMGN). Our reads are EVM only.
- The ceiling is low. At 20-odd monthly users and about $1–1.50 per 1,000 tokens, a winning actor
  here earns tens to low hundreds of dollars a month, not more.

What the evidence says not to do:

- **Do not put more work into sanctions screening** on either marketplace. No listing shows buyers.
- **Do not clone ax1's token verdict on x402 and expect its volume.** We already ship the same
  thing at the same price; the gap is distribution we do not have.
- If the test for a new product is "people already pay and ours would clearly win", **nothing we
  have passes it today.** The actor above is the best-evidenced bet, not a proven one.

## How this was measured

- Apify store: public `GET /v2/store` search, 20 terms, sorted by popularity; price and stats
  lines from each actor's public `.md` page.
- Our Apify actors: authenticated API (actor stats, our own run list).
- Our x402 income: every USDC `Transfer` to `0xe0ed…83de` on Base over 1,296,000 blocks (1 of
  1,297 pages failed and was not retried). Crawler test: the payer's own outgoing USDC transfers
  in the ~3 hours around its last payment to us.
- x402 market: every resource in the CDP Bazaar discovery index, with its 30-day call and
  unique-payer counts.
