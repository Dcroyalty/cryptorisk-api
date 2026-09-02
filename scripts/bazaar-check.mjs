// scripts/bazaar-check.mjs
// Lists every x402 resource the Coinbase CDP facilitator has indexed for our
// payTo address. A resource shows up here only AFTER the CDP facilitator has
// settled at least one real payment for it (or picked it up via a resource
// server's discovery extension). If this prints nothing, run scripts/self-pay.mjs.
//
//   node scripts/bazaar-check.mjs
//
// No credentials needed — /v2/x402/discovery/merchant is a public CDP endpoint.
import { listX402DiscoveryMerchant } from "@coinbase/cdp-sdk";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const PAGE = 100;

function priceLine(accepts = []) {
  return (
    accepts
      .map((a) => {
        const amt = a.maxAmountRequired ?? a.amount ?? a.price ?? "?";
        const asset = a.extra?.name ?? a.asset ?? "";
        const net = a.network ?? "?";
        return `${amt} ${asset} @ ${net}`.replace(/\s+/g, " ").trim();
      })
      .join("  |  ") || "(none listed)"
  );
}

const resources = [];
let offset = 0;
for (;;) {
  const res = await listX402DiscoveryMerchant({ payTo: PAY_TO, limit: PAGE, offset });
  const batch = res?.resources ?? [];
  resources.push(...batch);
  const total = res?.pagination?.total ?? resources.length;
  offset += PAGE;
  if (batch.length === 0 || resources.length >= total) break;
}

console.log(`payTo: ${PAY_TO}`);
console.log(`indexed resources: ${resources.length}\n`);

if (resources.length === 0) {
  console.log("Nothing indexed yet. The CDP facilitator has not settled a payment");
  console.log("for any resource under this address. Run: node scripts/self-pay.mjs");
  process.exit(0);
}

for (const r of resources) {
  console.log(`• ${r.resource}`);
  console.log(`    type ${r.type ?? "?"}   x402Version ${r.x402Version ?? "?"}`);
  if (r.description) console.log(`    ${r.description}`);
  console.log(`    price: ${priceLine(r.accepts)}`);
  if (r.serviceName) console.log(`    service: ${r.serviceName}`);
  if (r.tags?.length) console.log(`    tags: ${r.tags.join(", ")}`);
  if (r.quality) {
    const q = r.quality;
    console.log(
      `    activity(30d): ${q.l30DaysTotalCalls ?? 0} calls, ` +
        `${q.l30DaysUniquePayers ?? 0} payers` +
        (q.lastCalledAt ? `, last ${q.lastCalledAt}` : ""),
    );
  }
  if (r.extensions && Object.keys(r.extensions).length)
    console.log(`    extensions: ${Object.keys(r.extensions).join(", ")}`);
  if (r.lastUpdated) console.log(`    lastUpdated: ${r.lastUpdated}`);
  console.log();
}
