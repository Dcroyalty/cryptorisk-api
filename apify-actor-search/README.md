# Google Search Scraper — Organic, PAA, Related Searches

Give it a query. Get back organic results, People Also Ask, and related searches — confirmed live, every time, not a maybe.

## What this actually delivers (and how we know)

Before writing this README we ran 13 distinct queries against two separate Serper accounts, including the textbook trigger queries every SERP tool demos with — "eiffel tower," "how tall is the eiffel tower," "elon musk," "barack obama," commercial buy-intent terms like "buy dyson v15 vacuum" and "nike air max." We inspected the **raw, unmapped upstream response** for several of them, not just our own output.

Result: `organic`, `people_also_ask`, and `related_searches` populated on every query. `ads`, `shopping`, `knowledge_graph`, `answer_box`, and `ai_overview` populated on **zero** of the 13 — including the ones that should be unmissable, like a direct factual question ("what year was the eiffel tower built") or an unambiguous public figure ("barack obama"). That's not a bug in this actor; it's what the upstream API actually returns for these accounts. So that's not what this actor is sold on.

- **Organic results** — title, url, description, position, and (when Google includes them) sitelinks, per-result attributes, and a date
- **People Also Ask** — the expandable question list
- **Related searches** — the query-refinement suggestions at the bottom of the page

## What you get back, per query — real, captured output

This is an actual run of this actor against `"elon musk"`, unedited except for trimming the organic list to save space (the real run returned 9 organic results; 3 are shown):

```json
{
  "query": "elon musk",
  "results": [
    { "title": "Elon Musk", "url": "https://en.wikipedia.org/wiki/Elon_Musk", "description": "Elon Reeve Musk is a businessman and former public official who is the chief executive officer (CEO) and largest shareholder of Tesla and SpaceX. Musk has ...", "score": 1 },
    { "title": "Elon Musk (@elonmusk) / X", "url": "https://x.com/elonmusk", "description": "Listen to Elon. Purchase Suicidal Empathy now, and contribute to the defence of the West! 1.6K · 4.1K · 29K · 6.4M · @elonmusk · Elon Musk · X.", "score": 0.889 },
    { "title": "Elon Musk", "url": "https://www.tesla.com/elon-musk", "description": "As the co-founder and CEO of Tesla, Elon leads all product design, engineering and global manufacturing of the company's electric vehicles, battery products and ...", "score": 0.778 }
  ],
  "organic": [
    { "title": "Elon Musk", "url": "https://en.wikipedia.org/wiki/Elon_Musk", "description": "Elon Reeve Musk is a businessman and former public official who is the chief executive officer (CEO) and largest shareholder of Tesla and SpaceX. Musk has ...", "position": 1 }
  ],
  "ads": [],
  "people_also_ask": [
    { "question": "What is Musk diagnosed with?" },
    { "question": "Does Musk believe in God?" },
    { "question": "Is Elon Musk a trillionaire?" },
    { "question": "Does Elon have 14 children?" }
  ],
  "related_searches": ["Elon Musk net worth", "Elon Musk children", "Elon Musk book", "Elon Musk wife", "Elon Musk car", "Elon Musk Twitter", "Elon Musk age", "Elon Musk money"],
  "knowledge_graph": null,
  "answer_box": null,
  "shopping": [],
  "ai_overview": null,
  "latency_ms": 1978,
  "checked_at": "2026-09-18T07:48:45.997Z"
}
```

Note `knowledge_graph`, `answer_box`, and `shopping` are `null`/`[]` here — for "elon musk," a query that triggers a knowledge panel on google.com directly. That's the honest, representative case, not the exception.

## The optional fields — one honest mention

`ads`, `shopping`, `knowledge_graph`, `answer_box`, and `ai_overview` are present in every response's schema and populate **when the upstream response includes them** — they're not stripped out or faked empty. We just don't sell them, because across 13 test queries on two accounts, none of them ever did. If you find a query where one of these reliably populates, that's useful data — the code already handles it correctly, it just hasn't been observed happening.

## Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `queries` | array of strings | yes | Up to 1,000 per run. One charge event per query executed. |
| `num` | integer | no (default 10) | Organic results requested per query, 1-100. |
| `country` | string | no | 2-letter country code (Google `gl`). Confirmed working — verified geo-targeted results (Spain, Japan, France) in live testing. |
| `language` | string | no | 2+ letter language code (Google `hl`). Confirmed working — verified Spanish-language results for a Spanish query. |
| `page` | integer | no (default 1) | 1-based result page. Confirmed working — page 2 returns genuinely different results than page 1. |
| `device` | string | no | Forwarded to Serper as-is. Accepted without error but no observed effect in testing — not confirmed to do anything. |

A query that fails upstream (Serper error, network failure) gets a `{ "error": ... }` record instead of failing the whole run — and isn't charged.

## Pricing

**$0.90 per 1,000 results returned** (pay-per-event, one `query-executed` event per query — at the default `num: 10` that's $0.009/query). This is mid-band for the category's $0.11–$1.80-per-1,000 range: not the floor, because organic + PAA + related is a genuine step up from the bare 5-field organic-only scrapers that sit at 1-2 users each; not the top, because we're not claiming the ad/shopping/knowledge-graph depth the dominant incumbent has and we've confirmed we can't currently deliver.

## What this is not

Not a multi-engine tool — it calls Google, through Serper, and nothing else. Not a relevance engine — `score` is rank-derived, same as the rest of the category. Not a source of ads, shopping listings, knowledge-graph data, answer boxes, or AI Overviews — those fields exist in the schema and will populate if the upstream ever returns them for your query, but treat that as a bonus, never an expectation.
