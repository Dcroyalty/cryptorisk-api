// scripts/market-scan.mjs — what is actually selling on the x402 network.
//
// Pages the entire CDP x402 discovery index (public, no auth — same source as
// scripts/bazaar-check.mjs) and reports demand: calls, unique payers, price
// distribution, and a rough category rollup. Read-only. Builds nothing.
//
//   node scripts/market-scan.mjs
import { listX402DiscoveryResources } from "@coinbase/cdp-sdk";

const PAGE = 100;

// ---- pull every resource ----
const all = [];
let offset = 0;
let total = Infinity;
for (;;) {
  const res = await listX402DiscoveryResources({ limit: PAGE, offset });
  const items = res?.items ?? res?.resources ?? [];
  total = res?.pagination?.total ?? items.length;
  all.push(...items);
  process.stderr.write(`  fetched ${all.length}/${total}\r`);
  offset += PAGE;
  if (items.length === 0 || all.length >= total) break;
}
process.stderr.write(`\n`);

// ---- normalise ----
function priceUsd(accepts = []) {
  const vals = accepts
    .map((a) => {
      const raw = a.maxAmountRequired ?? a.amount ?? a.price;
      if (raw == null) return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      // x402 amounts are atomic units; USDC (and the stables used here) are 6dp
      return n / 1e6;
    })
    .filter((v) => v != null);
  return vals.length ? Math.min(...vals) : null;
}
function network(accepts = []) {
  return accepts.find((a) => a.network)?.network ?? "?";
}
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "?";
  }
}

const rows = all.map((r) => {
  const q = r.quality ?? {};
  return {
    resource: r.resource ?? "?",
    domain: domainOf(r.resource ?? ""),
    description: (r.description ?? "").replace(/\s+/g, " ").trim(),
    price: priceUsd(r.accepts),
    network: network(r.accepts),
    calls: Number(q.l30DaysTotalCalls ?? 0),
    payers: Number(q.l30DaysUniquePayers ?? 0),
    lastCalledAt: q.lastCalledAt ?? null,
  };
});

// dump normalised rows so categorisation can be re-derived without re-fetching
try {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("../.market-scan.json", import.meta.url), JSON.stringify(rows));
} catch {}

const money = (v) => (v == null ? "  n/a  " : "$" + v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const totalCalls = rows.reduce((a, r) => a + r.calls, 0);
const totalPayers = rows.reduce((a, r) => a + r.payers, 0);

console.log(`\n=== x402 MARKET SCAN ===`);
console.log(`resources indexed: ${rows.length}   |   30d calls (sum): ${totalCalls.toLocaleString()}   |   30d payers (sum): ${totalPayers.toLocaleString()}`);
console.log(`scanned: ${new Date().toISOString()}\n`);

// ---- 1. TOP 30 BY CALLS ----
console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`1. TOP 30 BY CALLS (30d) — the demand list`);
console.log(`────────────────────────────────────────────────────────────────────────`);
console.log(`${pad("#", 3)} ${rpad("calls", 8)} ${rpad("payers", 7)} ${rpad("price", 9)}  ${pad("domain", 26)} description`);
[...rows]
  .sort((a, b) => b.calls - a.calls)
  .slice(0, 30)
  .forEach((r, i) => {
    console.log(`${pad(i + 1, 3)} ${rpad(r.calls, 8)} ${rpad(r.payers, 7)} ${rpad(money(r.price), 9)}  ${pad(r.domain, 26)} ${r.description.slice(0, 70)}`);
  });

// ---- 2. TOP 30 BY UNIQUE PAYERS ----
console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`2. TOP 30 BY UNIQUE PAYERS (30d) — repeatable demand, not one integration`);
console.log(`────────────────────────────────────────────────────────────────────────`);
console.log(`${pad("#", 3)} ${rpad("payers", 7)} ${rpad("calls", 8)} ${rpad("c/payer", 8)} ${rpad("price", 9)}  ${pad("domain", 26)} description`);
[...rows]
  .sort((a, b) => b.payers - a.payers)
  .slice(0, 30)
  .forEach((r, i) => {
    const cpp = r.payers ? (r.calls / r.payers).toFixed(1) : "—";
    console.log(`${pad(i + 1, 3)} ${rpad(r.payers, 7)} ${rpad(r.calls, 8)} ${rpad(cpp, 8)} ${rpad(money(r.price), 9)}  ${pad(r.domain, 26)} ${r.description.slice(0, 66)}`);
  });

// ---- 3. PRICE DISTRIBUTION ----
console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`3. PRICE DISTRIBUTION — where the money is`);
console.log(`────────────────────────────────────────────────────────────────────────`);
const BUCKETS = [
  { name: "free ($0)", test: (p) => p === 0 },
  { name: "$0.001–0.009", test: (p) => p > 0 && p < 0.01 },
  { name: "$0.01 (exact)", test: (p) => Math.abs(p - 0.01) < 1e-9 },
  { name: "$0.02–0.09", test: (p) => p > 0.01 && p < 0.10 },
  { name: "$0.10–0.49", test: (p) => p >= 0.10 && p < 0.50 },
  { name: "$0.50+", test: (p) => p >= 0.50 },
  { name: "unknown price", test: (p) => p == null },
];
console.log(`${pad("bucket", 16)} ${rpad("count", 7)} ${rpad("calls", 10)} ${rpad("calls/res", 10)} ${rpad("payers", 9)}`);
for (const b of BUCKETS) {
  const inb = rows.filter((r) => (r.price == null ? b.name === "unknown price" : b.test(r.price)));
  const c = inb.reduce((a, r) => a + r.calls, 0);
  const p = inb.reduce((a, r) => a + r.payers, 0);
  console.log(`${pad(b.name, 16)} ${rpad(inb.length, 7)} ${rpad(c.toLocaleString(), 10)} ${rpad(inb.length ? (c / inb.length).toFixed(1) : "0", 10)} ${rpad(p.toLocaleString(), 9)}`);
}

// ---- 4. CATEGORY ROLLUP ----
console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`4. CATEGORY ROLLUP — grouped by what the description says it does`);
console.log(`────────────────────────────────────────────────────────────────────────`);
const CATS = [
  ["risk/security", /\b(risk|scam|sanction|honeypot|phish|exploit|malicious|fraud|rug|aml|kyc|compliance|blocklist|denylist|threat|security|audit|abuse|safe(ty)?|due dilig|impersonat|depeg|screening|attest)\b/i],
  ["images", /\b(image|photo|dall[- ]?e|stable diffusion|midjourney|vision|ocr|thumbnail|render(ing)?|avatar|logo|\bart\b|text[- ]to[- ]image|upscale|background removal)\b/i],
  ["LLM", /\b(llm|gpt[- ]?\d|gpt-4o|claude|gemini|llama|mistral|completion|chat model|inference|prompt|language model|text generation|summar(y|ize|isation|ies)|translat|\bembed(ding)?s?\b|rerank|per-?token|\btokens?\b answer)\b/i],
  ["scraping", /\b(scrape|scraping|crawl|crawler|fetch (the |a )?page|html to|to markdown|web page|\bbrowser\b|screenshot|readability|readable|retrieve content|page content|web content|extract (full )?(text|content|the content|markdown)|firecrawl (scrape|crawl)|url.? to (markdown|text))\b/i],
  ["search", /\b(search|serp|web results|google results|\bbing\b|duckduckgo|query the web|news feed|news headlines|find .*(url|website|page)|exa\b|tavily|neural search)\b/i],
  ["data/onchain", /\b(chain|block ?(number|height|header)|balance|token|erc[- ]?\d+|\brpc\b|on[- ]?chain|wallet|transaction|\btx\b|receipt|\bnft\b|contract|\bdex\b|defi|price feed|oracle|ohlc|market data|\bgas\b|nonce|\bens\b|swap|liquidity|holders?|enrich|linkedin|\bemail\b|deliverab|\bdns\b|whois|\bip\b address|geoloc|stock|ticker|\bfx\b|forex|\bquote\b|dataset|weather|trends)\b/i],
];
function categorize(desc) {
  for (const [name, re] of CATS) if (re.test(desc)) return name;
  return "other";
}
const roll = {};
for (const r of rows) {
  const c = categorize(r.description);
  (roll[c] ??= { count: 0, calls: 0, payers: 0 });
  roll[c].count++;
  roll[c].calls += r.calls;
  roll[c].payers += r.payers;
}
console.log(`${pad("category", 16)} ${rpad("count", 7)} ${rpad("calls", 12)} ${rpad("payers", 10)} ${rpad("calls/res", 10)}`);
Object.entries(roll)
  .sort((a, b) => b[1].calls - a[1].calls)
  .forEach(([name, v]) => {
    console.log(`${pad(name, 16)} ${rpad(v.count, 7)} ${rpad(v.calls.toLocaleString(), 12)} ${rpad(v.payers.toLocaleString(), 10)} ${rpad((v.calls / v.count).toFixed(1), 10)}`);
  });

// ---- 5. SHORTLIST: >50 calls/30d, full description + price ----
console.log(`\n────────────────────────────────────────────────────────────────────────`);
console.log(`5. SHORTLIST — every resource with >50 calls in 30d (things people pay for)`);
console.log(`────────────────────────────────────────────────────────────────────────`);
const shortlist = rows.filter((r) => r.calls > 50).sort((a, b) => b.calls - a.calls);
console.log(`${shortlist.length} resources\n`);
for (const r of shortlist) {
  console.log(`• ${r.calls} calls / ${r.payers} payers  —  ${money(r.price)}  ${r.network}`);
  console.log(`  ${r.resource}`);
  console.log(`  [${r.domain}] ${categorize(r.description)}`);
  console.log(`  ${r.description || "(no description)"}`);
  console.log(`  last called: ${r.lastCalledAt ?? "?"}`);
  console.log();
}
