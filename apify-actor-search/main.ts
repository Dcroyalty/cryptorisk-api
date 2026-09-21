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
//
// NEVER EXIT FAILED ON A HANDLED CONDITION. Apify's automated QA runs the actor
// with the INPUT_SCHEMA prefill values and marks it "Under maintenance" on any
// run that is not SUCCEEDED within 5 minutes. So every code path below that is
// not a genuine crash — missing key, empty/oversized input, an upstream 401/403/
// 429/5xx, a timeout, an unparseable response, a charge limit — pushes a dataset
// item that says what happened and exits SUCCEEDED (exit code 0). Only an
// unexpected exception in main() reaches Actor.fail().

import { Actor, log } from "apify";
import { mapSerperResponse } from "@/lib/serper-map";

const MAX_QUERIES = 1000;
const CHARGE_EVENT = "query-executed";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_500;

interface Input {
  queries?: string[] | string;
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

/** Map an upstream HTTP failure to a stable, human-readable error code + hint. */
function classifyUpstream(status: number, detail: string): { error: string; hint: string } {
  const d = detail.toLowerCase();
  if (d.includes("credit")) {
    return { error: "upstream_credits_exhausted", hint: "The Serper account behind this Actor has no credits left. Top up at serper.dev." };
  }
  if (status === 401 || status === 403) {
    return { error: "upstream_auth_error", hint: "Serper rejected the API key. Check SERPER_API_KEY under this Actor's Settings -> Environment variables." };
  }
  if (status === 429) return { error: "upstream_rate_limited", hint: "Serper rate limit hit. Retry the run in a minute." };
  if (status >= 500) return { error: "upstream_unavailable", hint: "Serper returned a server error. Retry the run later." };
  return { error: "upstream_error", hint: "Serper rejected the request. See message for its response." };
}

async function main(): Promise<void> {
  await Actor.init();

  let pushed = 0;
  let errors = 0;

  /** Push a record that explains what happened. `query` stays a string (dataset schema). */
  const notice = async (query: string, error: string, message: string, extra: { status?: number; hint?: string } = {}) => {
    await Actor.pushData({ query, error, message, ...extra, checked_at: new Date().toISOString() });
    pushed++;
    errors++;
  };

  /** Every path ends here: guarantee at least one dataset item, then exit SUCCEEDED. */
  const finish = async (statusMessage: string): Promise<void> => {
    if (pushed === 0) {
      await Actor.pushData({ query: "", error: "no_output", message: "The run completed without producing any results.", checked_at: new Date().toISOString() });
      pushed++;
    }
    log.info(statusMessage);
    await Actor.exit({ statusMessage, exitCode: 0 });
  };

  const input = (await Actor.getInput<Input>()) ?? {};
  const rawQueries = Array.isArray(input.queries) ? input.queries : typeof input.queries === "string" ? [input.queries] : [];
  let queries = rawQueries.map((q) => String(q ?? "").trim()).filter(Boolean);
  const num = Math.min(Math.max(Math.trunc(Number(input.num)) || 10, 1), 100);
  const { country, language, device } = input;
  const page = Number.isInteger(Number(input.page)) && Number(input.page) >= 1 ? Number(input.page) : undefined;

  const apiKey = (process.env.SERPER_API_KEY ?? "").trim();
  if (!apiKey) {
    await notice("", "missing_api_key", "SERPER_API_KEY is not set for this Actor, so no search was run.", {
      hint: "Add SERPER_API_KEY under this Actor's Settings -> Environment variables in the Apify Console, then run again.",
    });
    return finish("No search run: SERPER_API_KEY is not configured (see the dataset item).");
  }

  if (queries.length === 0) {
    await notice("", "no_queries", 'Input must include a non-empty "queries" array, so no search was run.', {
      hint: 'Example input: { "queries": ["web scraping tools"], "num": 3 }',
    });
    return finish('No search run: no "queries" in the input (see the dataset item).');
  }

  if (queries.length > MAX_QUERIES) {
    const skipped = queries.length - MAX_QUERIES;
    queries = queries.slice(0, MAX_QUERIES);
    await notice("", "too_many_queries", `Got ${MAX_QUERIES + skipped} queries; this Actor caps at ${MAX_QUERIES} per run. The first ${MAX_QUERIES} were run; ${skipped} were skipped.`, {
      hint: "Split the remaining queries into another run.",
    });
  }

  let processed = 0;
  let stopped = false;

  for (const q of queries) {
    if (stopped) break;
    const started = Date.now();
    const body: Record<string, unknown> = { q, num };
    if (country) body.gl = country;
    if (language) body.hl = language;
    if (page) body.page = page;
    if (device) body.device = device;

    // One retry for a transient upstream condition (rate limit / 5xx / network); nothing is charged for failures.
    let res: Response | null = null;
    let networkError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        networkError = null;
        if (res.status !== 429 && res.status < 500) break;
      } catch (e) {
        networkError = e;
        res = null;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }

    if (!res) {
      const e = networkError as Error | null;
      const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
      await notice(q, timedOut ? "request_timeout" : "request_failed", String(e?.message ?? e ?? "request failed"), {
        hint: "Network error reaching Serper. Retry the run later.",
      });
      continue;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const { error, hint } = classifyUpstream(res.status, detail);
      await notice(q, error, detail.slice(0, 500) || `HTTP ${res.status}`, { status: res.status, hint });
      // Auth / credit failures repeat for every remaining query — stop instead of burning the loop.
      if (error === "upstream_auth_error" || error === "upstream_credits_exhausted") {
        stopped = true;
        log.warning(`${error}: stopping — the same failure would repeat for every remaining query.`);
      }
      continue; // no charge — Serper didn't return results
    }

    let mapped;
    try {
      const raw = await res.json();
      mapped = mapSerperResponse(raw);
    } catch (e) {
      await notice(q, "invalid_upstream_response", `Serper returned a response that could not be read: ${String((e as Error)?.message ?? e)}`.slice(0, 500), {
        status: res.status,
        hint: "Retry the run. If it persists, the upstream response format may have changed.",
      });
      continue;
    }

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
    pushed++;
    processed++;

    // The result is already delivered; a charging problem must never fail the run.
    try {
      const charge = await Actor.charge({ eventName: CHARGE_EVENT, count: 1 });
      if (charge?.eventChargeLimitReached) {
        await notice("", "charge_limit_reached", "The maximum charge for this run was reached, so remaining queries were not run.", {
          hint: "Raise the run's maximum cost and run the remaining queries again.",
        });
        stopped = true;
      }
    } catch (e) {
      log.warning(`Actor.charge failed (result kept, run continues): ${String((e as Error)?.message ?? e)}`);
    }
  }

  await finish(`Executed ${processed}/${queries.length} quer${queries.length === 1 ? "y" : "ies"}${errors ? `; ${errors} error record${errors === 1 ? "" : "s"} in the dataset` : ""}.`);
}

// A genuine crash (a bug, out of memory, the dataset itself unwritable) is the ONLY thing that may fail the run.
main().catch(async (err) => {
  log.exception(err as Error, "Unhandled error in main()");
  await Actor.fail(err instanceof Error ? err.message : String(err));
});
