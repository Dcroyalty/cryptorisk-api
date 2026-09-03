// scripts/competitor-teardown.mjs — pull the full discovery record AND the live
// 402 challenge for a set of x402 search/scraping resources, plus our own, so we
// can see exactly what each one advertises and returns. Read-only. Builds nothing.
//
//   node scripts/competitor-teardown.mjs
import { listX402DiscoveryResources } from "@coinbase/cdp-sdk";
import { writeFileSync } from "node:fs";

const TARGETS = [
  "stableenrich.dev/api/exa/search",
  "stableenrich.dev/api/exa/contents",
  "api.exa.ai/search",
  "stableenrich.dev/api/firecrawl/search",
  "blockrun.ai",
  "tavily.com",
  "oneshotagent.com",
  "kadec0.xyz",
  "uxus.finance/api/search",
  "uxus.finance/api/scrape",
];

const all = [];
let offset = 0;
let total = Infinity;
for (;;) {
  const res = await listX402DiscoveryResources({ limit: 100, offset });
  const items = res?.items ?? [];
  total = res?.pagination?.total ?? items.length;
  all.push(...items);
  process.stderr.write(`  ${all.length}/${total}\r`);
  if (!items.length || all.length >= total) break;
}
process.stderr.write("\n");

const matched = all.filter((r) =>
  TARGETS.some((t) => (r.resource || "").toLowerCase().includes(t.toLowerCase())),
);

// full domain context
const domains = ["blockrun.ai", "stableenrich.dev", "win.oneshotagent.com", "api.kadec0.xyz", "x402.tavily.com", "api.exa.ai", "uxus.finance"];
const byDomain = {};
for (const r of all) {
  try {
    const h = new URL(r.resource).hostname;
    if (domains.includes(h))
      (byDomain[h] ??= []).push({
        resource: r.resource,
        description: r.description,
        priceAtomic: r.accepts?.map((a) => a.maxAmountRequired ?? a.amount),
        calls: r.quality?.l30DaysTotalCalls,
        payers: r.quality?.l30DaysUniquePayers,
      });
  } catch {}
}

// live 402 fetch
async function probe402(url, method = "GET") {
  const out = { url, method, status: null, headers: {}, body: null };
  try {
    const r = await fetch(url, {
      method,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
      redirect: "manual",
    });
    out.status = r.status;
    for (const h of ["payment-required", "www-authenticate", "x-payment", "content-type"]) {
      const v = r.headers.get(h);
      if (v) out.headers[h] = v;
    }
    const txt = await r.text();
    try {
      out.body = JSON.parse(txt);
    } catch {
      out.body = txt.slice(0, 1200);
    }
  } catch (e) {
    out.error = String(e?.message ?? e);
  }
  return out;
}

const probes = {};
for (const r of matched) {
  // guess method from the bazaar extension, default GET, and try POST if GET isn't 402
  const m = r.extensions?.bazaar?.info?.input?.method || "GET";
  let p = await probe402(r.resource, m);
  if (p.status !== 402 && m === "GET") {
    const p2 = await probe402(r.resource, "POST");
    if (p2.status === 402) p = p2;
  }
  probes[r.resource] = p;
}

writeFileSync(new URL("../.teardown.json", import.meta.url), JSON.stringify({ matched, byDomain, probes }, null, 2));

for (const r of matched) {
  console.log("=".repeat(95));
  console.log(r.resource);
  console.log("-".repeat(95));
  console.log("description:\n  " + JSON.stringify(r.description));
  console.log(`type=${r.type} x402Version=${r.x402Version} lastUpdated=${r.lastUpdated}`);
  console.log(`quality: ${JSON.stringify(r.quality)}`);
  for (const a of r.accepts || []) {
    const usd = (Number(a.maxAmountRequired ?? a.amount) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    console.log(`accepts: $${usd}  scheme=${a.scheme} network=${a.network} payTo=${a.payTo}`);
    if (a.extra && Object.keys(a.extra).length) console.log(`  extra: ${JSON.stringify(a.extra)}`);
    if (a.outputSchema) console.log(`  outputSchema: ${JSON.stringify(a.outputSchema)}`);
  }
  if (r.extensions) console.log("extensions:\n" + JSON.stringify(r.extensions, null, 1));
  const p = probes[r.resource];
  console.log(`\nLIVE 402 PROBE (${p?.method}): status ${p?.status}`);
  if (p?.headers && Object.keys(p.headers).length) console.log("  headers: " + JSON.stringify(p.headers));
  console.log("  body: " + JSON.stringify(p?.body, null, 1)?.slice(0, 2500));
  if (p?.error) console.log("  error: " + p.error);
  console.log();
}

console.log("\n\n### DOMAIN CONTEXT ###");
for (const [d, list] of Object.entries(byDomain)) {
  console.log(`\n${d}  (${list.length} resources)`);
  for (const x of list.sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0))) {
    const usd = x.priceAtomic?.map((v) => "$" + (Number(v) / 1e6).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")).join("/");
    console.log(`  ${String(x.calls ?? 0).padStart(6)} calls ${String(x.payers ?? 0).padStart(4)}p  ${(usd || "?").padEnd(12)} ${x.resource}`);
    console.log(`         ${(x.description || "").slice(0, 110)}`);
  }
}
