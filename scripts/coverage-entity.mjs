// scripts/coverage-entity.mjs — 20-address coverage test for entity_labels.
// Reports hit/miss and Base-vs-Ethereum hit rates.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
const url = (
  process.env.DATABASE_URL ||
  readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim()
).replace(/^["']|["']$/g, "");
const sql = neon(url);

const SEVERITY = { sanctioned: 100, drainer: 90, phishing: 85, scam: 80, mixer: 70, bridge: 40, exchange: 35, dex_router: 30, protocol: 20, token_contract: 10, unknown: 0 };
const SRANK = { curated: 5, ofac: 4, "eth-labels": 3, scamsniffer: 2, mew: 1 };

async function lookupEntity(address, chain) {
  const addr = address.toLowerCase();
  const chains = chain === "base" ? ["base", "evm"] : ["ethereum", "evm"];
  const rows = await sql`SELECT label, category, source FROM entity_labels WHERE address=${addr} AND chain = ANY(${chains})`;
  if (!rows.length) return { is_known: false, label: null, category: "unknown", sources: [] };
  let best = rows[0];
  for (const r of rows) {
    const s = SEVERITY[r.category] ?? 0, bs = SEVERITY[best.category] ?? 0;
    if (s > bs || (s === bs && (SRANK[r.source] ?? 0) > (SRANK[best.source] ?? 0))) best = r;
  }
  return { is_known: true, label: best.label, category: best.category, sources: [...new Set(rows.map((r) => r.source))].sort() };
}

// a real scamsniffer address + a confirmed-unlabeled EOA, from the DB
const scamRow = (await sql`SELECT address FROM entity_labels WHERE source='scamsniffer' LIMIT 1`)[0];
async function unlabeled(cand) {
  for (const a of cand) {
    const r = await sql`SELECT 1 FROM entity_labels WHERE address=${a.toLowerCase()} LIMIT 1`;
    if (!r.length) return a;
  }
  return cand[0];
}
const rnd1 = await unlabeled(["0x1111111111111111111111111111111111111111", "0x9a8f92a830a5cb89a3816e3d267cb7791c16b04d"]);
const rnd2 = await unlabeled(["0xc5a2d2ee34f74A68174A0Ba937655D8463EaDDa2", "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de"]);

const TESTS = [
  // [chain, address, acceptable[], note]
  ["ethereum", "0x098B716B8Aaf21512996dC57EB0615e2383E2f96", ["sanctioned"], "Ronin/Lazarus exploiter (OFAC)"],
  ["ethereum", "0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936", ["mixer", "sanctioned"], "Tornado.Cash 1 ETH pool"],
  ["ethereum", "0x28C6c06298d514Db089934071355E5743bf21d60", ["exchange"], "Binance 14 HOT wallet"],
  ["ethereum", "0x02a3595787f9d2b738ecd6c08374745316bf3234", ["exchange"], "Binance DEPOSIT address"],
  ["ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", ["token_contract"], "USDC (Ethereum)"],
  ["ethereum", "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", ["dex_router"], "Uniswap Universal Router"],
  ["ethereum", "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", ["protocol"], "Aave v3 Pool"],
  ["ethereum", scamRow?.address || "0x0000000000000000000000000000000000000009", ["scam", "phishing", "drainer"], "ScamSniffer-listed address"],
  ["ethereum", "0x3ee18B2214AFf97000D974cf647E7C347E8fa585", ["bridge"], "Wormhole: Token Bridge"],
  ["ethereum", rnd1, ["unknown"], "unlabeled EOA"],

  ["base", "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", ["dex_router"], "Aerodrome Router"],
  ["base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ["token_contract"], "USDC (Base)"],
  ["base", "0x4200000000000000000000000000000000000010", ["bridge"], "Base L2 Standard Bridge"],
  ["base", "0x6fF5693b99212Da76ad316178A184AB56D299b43", ["dex_router"], "Uniswap Universal Router (Base)"],
  ["base", "0x4200000000000000000000000000000000000006", ["token_contract"], "WETH (Base)"],
  ["base", "0x0389879e0156033202C44BF784ac18fC02edeE4f", ["dex_router"], "SushiSwap RouteProcessor (Base)"],
  ["base", "0x2dc219e716793fb4b21548c0f009ba3af753ab01", ["protocol"], "Aave: Payloads Controller (Base)"],
  ["base", "0x940181a94A35A4569E4529A3CDfB74e38FD98631", ["token_contract"], "AERO token (Base)"],
  ["base", rnd2, ["unknown"], "unlabeled EOA"],
  ["base", "0x098B716B8Aaf21512996dC57EB0615e2383E2f96", ["sanctioned"], "OFAC addr via chain=base (chain-agnostic)"],
];

let hE = 0, tE = 0, hB = 0, tB = 0;
console.log("chain    | expected            | returned        | H/M  | label");
console.log("---------|---------------------|-----------------|------|--------------------------------");
for (const [chain, addr, exp, note] of TESTS) {
  const r = await lookupEntity(addr, chain);
  const hit = exp.includes(r.category);
  if (chain === "ethereum") { tE++; if (hit) hE++; } else { tB++; if (hit) hB++; }
  console.log(
    chain.padEnd(8) + " | " + exp.join("|").padEnd(19) + " | " + r.category.padEnd(15) + " | " +
    (hit ? "HIT " : "MISS").padEnd(4) + " | " + (r.label ? r.label.slice(0, 30) : "-") + "   " + note,
  );
}
console.log("\nEthereum: " + hE + "/" + tE + " = " + Math.round((100 * hE) / tE) + "%");
console.log("Base:     " + hB + "/" + tB + " = " + Math.round((100 * hB) / tB) + "%");
console.log("Overall:  " + (hE + hB) + "/" + (tE + tB) + " = " + Math.round((100 * (hE + hB)) / (tE + tB)) + "%");
process.exit(0);
