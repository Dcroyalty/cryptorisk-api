# Google Search SERP Scraper — Ads, PAA, Knowledge Graph, Shopping

Give it a query. Get back the whole SERP: organic results, ads, People Also Ask, related searches, the knowledge graph, shopping results with ratings, and Google's AI Overview when Google shows one. Not three fields wearing a search API's name.

## Why this one, not the others

Look at what's actually adopted on the Store: one Google-only actor has 183K+ users. Every actor built around querying *multiple* search engines — Bing, Baidu, Yandex, Brave, DuckDuckGo, ten platforms at once in one case — sits at 1-2 users each, despite being cheaper and covering more ground. The market already ran that experiment. It doesn't reward engine count. It rewards depth of structured data from Google specifically.

So this actor doesn't pitch multi-engine failover. It pitches the thing that's actually correlated with adoption: **everything a Google SERP carries, not just the ten blue links.**

- **Organic results** — title, url, description, position, sitelinks, and any per-result attributes Google attaches
- **Ads** — the sponsored block, kept separate from organic so you're never scoring an ad as a real result
- **People Also Ask** — the expandable question/answer pairs
- **Related searches** — the query-refinement suggestions at the bottom of the page
- **Knowledge graph** — entity panel: type, description, website, image, and attributes (founder, founded date, headquarters, whatever Google attaches to that entity)
- **Shopping results** — product listings with price, rating, rating count, seller, and delivery info
- **AI Overview** — passed through when Google generates one for the query

## What you get back, per query

```json
{
  "query": "wireless noise cancelling headphones",
  "results": [
    { "title": "Best Wireless Noise Cancelling Headphones 2026", "url": "https://example-review-site.com/best-anc-headphones", "description": "We tested 40 pairs over three months...", "score": 1 }
  ],
  "organic": [
    { "title": "Best Wireless Noise Cancelling Headphones 2026", "url": "https://example-review-site.com/best-anc-headphones", "description": "We tested 40 pairs over three months...", "position": 1 }
  ],
  "ads": [
    { "title": "Shop Noise Cancelling Headphones", "link": "https://example-retailer.com/headphones", "description": "Free shipping on orders over $35. Shop the latest models." }
  ],
  "people_also_ask": [
    { "question": "What is the best noise cancelling headphone brand?", "snippet": "Consumer testing consistently ranks...", "url": "https://example.com/brand-comparison" }
  ],
  "related_searches": ["best over ear headphones 2026", "noise cancelling earbuds vs headphones", "budget anc headphones"],
  "knowledge_graph": null,
  "answer_box": null,
  "shopping": [
    { "title": "Example ANC Headphones — Over Ear", "source": "Example Store", "url": "https://example-store.com/product/anc-headphones", "price": "$249.00", "rating": 4.6, "rating_count": 3841, "delivery": "Free delivery" }
  ],
  "ai_overview": null,
  "latency_ms": 640,
  "checked_at": "2026-09-18T12:00:00.000Z"
}
```

*(Illustrative — built from Serper's documented response shape, not a captured live run: this repo doesn't hold a Serper API key to run one against. `knowledge_graph`, `answer_box`, and `ai_overview` are `null` above because this particular query doesn't trigger them; a query like `"tesla"` would populate `knowledge_graph`, and a question-style query would populate `answer_box`.)*

## Every block, honestly scoped

- `results` matches the shape of uxus.finance's hosted `/api/search` (`title`, `url`, `description`, `score`) for anyone already integrated against that. `organic` carries the same rows with `position`, `sitelinks`, and `attributes` kept intact.
- `ads` and `ai_overview` are passed through **verbatim** from Serper's raw response. Neither has a publicly documented, stable field schema as of 2026-09 (checked against three independently maintained Serper client libraries — none of them model these two blocks at all), so instead of guessing field names and risking exactly the bug this actor exists to avoid — silently dropping data because we hand-mapped the wrong three fields — we don't touch them.
- `score` is a synthetic rank-derived number (1.0 for the top result, descending), not a real relevance signal from Google. Nobody in this category ships a real one; don't expect this actor to be the exception.
- `ai_overview` will be `null` for every query if Serper's API doesn't actually expose it — sources disagree on whether it does, and we have no way to confirm without a live key at doc-writing time. If it's there, you get it; if it's not, you get `null`, never a guess.

## Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `queries` | array of strings | yes | Up to 1,000 per run. One charge event per query executed. |
| `num` | integer | no (default 10) | Organic results requested per query, 1-100. |
| `country` | string | no | 2-letter country code (Google `gl`). |
| `language` | string | no | 2+ letter language code (Google `hl`). |
| `page` | integer | no (default 1) | 1-based result page. |
| `device` | string | no | Forwarded to Serper as-is. Not confirmed to change results — see note above. |

A query that fails upstream (Serper error, network failure) gets a `{ "error": ... }` record instead of failing the whole run — and isn't charged.

## Pricing

**$0.90 per 1,000 results returned** (pay-per-event, one `query-executed` event per query — at the default `num: 10` that's $0.009/query). That's the midpoint of this category's $0.11–$1.80-per-1,000 range, deliberately not the floor: the cheap end of that range is exactly where the abandoned, 1-2-user multi-engine actors sit. This actor is priced like the thing it's competing on — structured depth — not like a commodity organic-only scraper. It sits below the dominant incumbent's ~$1.80, reflecting that this is a new entrant not yet matching every one of their extras (lead enrichment, cross-engine AI-answer verification, full-page markdown fetch of result URLs).

## What this is not

Not a multi-engine tool — it calls Google, through Serper, and nothing else. Not a relevance engine — `score` is rank-derived, same as the rest of the category. Not a guarantee that `ads`, `shopping`, or `ai_overview` will be populated for every query — Google doesn't show every block for every search, and this actor never fabricates one that Google didn't return.
