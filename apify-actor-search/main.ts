// main.ts — Google Search SERP Scraper (Apify actor)
//
// Native: calls Serper's API directly from inside the actor. Does not proxy
// through uxus.finance — no extra hop, no dependency on that deployment's
// uptime, and the actor's own SERPER_API_KEY budget is entirely separate from
// the hosted endpoint's. The mapper (lib/serper-map.ts) is a byte-identical
// copy of the one backported into the hosted /api/search — same convention
// as apify-actor/lib/*.ts being copies of uxus.finance's production code.
//
// SERPER_API_KEY must be set as an Actor environment variable (Console ->
// this Actor -> Settings -> Environment variables), not as run input — it's
// a secret, not a per-run parameter.

import { Actor, log } from "apify";
import { mapSerperResponse } from "@/lib/serper-map";

const MAX_QUERIES = 1000;
const CHARGE_EVENT = "query-executed";

interface Input {
  queries?: string[];
  num?: number;
  country?: string;
  language?: string;
  page?: number;
  device?: string;
}

function withScores(results: { title: string; url: string; description: string }[]) {
  const n = results.length || 1;
  return results.map((r, i) => ({ ...r, score: Math.round(((n - i) / n) * 1000) / 1000 }));
}

async function main(): Promise<void> {
  await Actor.init();

  const input = (await Actor.getInput<Input>()) ?? {};
  const queries = Array.isArray(input.queries) ? input.queries.map((q) => String(q ?? "").trim()).filter(Boolean) : [];
  const num = Math.min(Math.max(Number(input.num) || 10, 1), 100);
  const { country, language, page, device } = input;

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    await Actor.fail(
      "SERPER_API_KEY is not set. Add it under this Actor's Settings -> Environment variables in the Apify Console before running.",
    );
    return;
  }

  if (queries.length === 0) {
    await Actor.fail('Input must include a non-empty "queries" array.');
    return;
  }

  if (queries.length > MAX_QUERIES) {
    await Actor.fail(`Got ${queries.length} queries — this actor caps at ${MAX_QUERIES} per run. Split into multiple runs.`);
    return;
  }

  let processed = 0;

  for (const q of queries) {
    const started = Date.now();
    const body: Record<string, unknown> = { q, num };
    if (country) body.gl = country;
    if (language) body.hl = language;
    if (page) body.page = page;
    if (device) body.device = device;

    let res: Response;
    try {
      res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      await Actor.pushData({
        query: q,
        error: "request_failed",
        message: String((e as Error)?.message ?? e),
        checked_at: new Date().toISOString(),
      });
      continue; // no charge — no data was returned
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await Actor.pushData({
        query: q,
        error: "upstream_error",
        status: res.status,
        message: detail.slice(0, 500),
        checked_at: new Date().toISOString(),
      });
      continue; // no charge — Serper didn't return results
    }

    const raw = await res.json();
    const mapped = mapSerperResponse(raw);
    const results = withScores(mapped.organic.map((o) => ({ title: o.title, url: o.url, description: o.description })));

    await Actor.pushData({
      query: q,
      results,
      organic: mapped.organic, // same rows, richer: position/sitelinks/attributes/date kept intact
      ads: mapped.ads,
      people_also_ask: mapped.people_also_ask,
      related_searches: mapped.related_searches,
      knowledge_graph: mapped.knowledge_graph,
      answer_box: mapped.answer_box,
      shopping: mapped.shopping,
      ai_overview: mapped.ai_overview,
      // Count fields exist purely so the Console table view (.actor/dataset_schema.json)
      // can show them as columns — the schema's display system has no built-in way to
      // derive an array's length, so it has to be computed and stored here instead.
      results_count: results.length,
      organic_count: mapped.organic.length,
      people_also_ask_count: mapped.people_also_ask.length,
      related_searches_count: mapped.related_searches.length,
      latency_ms: Date.now() - started,
      checked_at: new Date().toISOString(),
    });

    await Actor.charge({ eventName: CHARGE_EVENT, count: 1 });
    processed++;
  }

  log.info(`Executed ${processed}/${queries.length} quer${processed === 1 ? "y" : "ies"}.`);

  await Actor.exit();
}

main().catch(async (err) => {
  log.exception(err as Error, "Unhandled error in main()");
  await Actor.fail(err instanceof Error ? err.message : String(err));
});
