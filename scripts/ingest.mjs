// scripts/ingest.mjs — download free bad-address lists and load into Neon.
// Run: node scripts/ingest.mjs   (re-run anytime to refresh; it upserts)
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL || readEnv();
function readEnv() {
  try { const m = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m); return m ? m[1].trim().replace(/^["']|["']$/g,"") : null; } catch { return null; }
}
if (!url) { console.error("No DATABASE_URL in .env"); process.exit(1); }
const sql = neon(url);

const isEvm = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const norm = (a) => a.toLowerCase();

async function getJson(u) {
  const r = await fetch(u, { headers: { "user-agent": "cryptorisk-ingest" } });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.json();
}
async function getText(u) {
  const r = await fetch(u, { headers: { "user-agent": "cryptorisk-ingest" } });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.text();
}

// Batch upsert helper
async function upsert(rows) {
  if (!rows.length) return 0;
  // insert in chunks of 500 using UNNEST
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const addrs = chunk.map(r => r.address);
    const chains = chunk.map(r => r.chain);
    const sources = chunk.map(r => r.source);
    const cats = chunk.map(r => r.category);
    await sql`
      INSERT INTO bad_addresses (address, chain, source, category)
      SELECT * FROM UNNEST(${addrs}::text[], ${chains}::text[], ${sources}::text[], ${cats}::text[])
      ON CONFLICT (address, source) DO NOTHING
    `;
    inserted += chunk.length;
  }
  return inserted;
}

const results = {};

// 1) OFAC sanctioned ETH addresses (0xB10C nightly mirror)
try {
  const txt = await getText("https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt");
  const rows = txt.split(/\r?\n/).map(s => s.trim()).filter(isEvm).map(a => ({ address: norm(a), chain: "evm", source: "ofac", category: "sanctioned" }));
  await upsert(rows);
  results.ofac_eth = rows.length;
} catch (e) { results.ofac_eth = `ERR ${e.message}`; }

// 2) ScamSniffer blacklist (EVM scam/phishing/drainer)
try {
  const arr = await getJson("https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json");
  const list = Array.isArray(arr) ? arr : Object.keys(arr || {});
  const rows = list.map(String).filter(isEvm).map(a => ({ address: norm(a), chain: "evm", source: "scamsniffer", category: "scam" }));
  await upsert(rows);
  results.scamsniffer = rows.length;
} catch (e) { results.scamsniffer = `ERR ${e.message}`; }

// 3) MyEtherWallet darklist (malicious addresses)
try {
  const arr = await getJson("https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json");
  const rows = (Array.isArray(arr) ? arr : []).map(o => o && o.address).map(String).filter(isEvm).map(a => ({ address: norm(a), chain: "evm", source: "mew", category: "scam" }));
  await upsert(rows);
  results.mew = rows.length;
} catch (e) { results.mew = `ERR ${e.message}`; }

const total = await sql`SELECT count(*)::int AS n FROM bad_addresses`;
const bySource = await sql`SELECT source, count(*)::int AS n FROM bad_addresses GROUP BY source ORDER BY n DESC`;
console.log("Ingest results:", results);
console.log("By source:", bySource);
console.log("TOTAL bad_addresses:", total[0].n);
