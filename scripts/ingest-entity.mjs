// scripts/ingest-entity.mjs — populate entity_labels ("what IS this address").
// Writes ONLY to entity_labels. Never reads or writes bad_addresses / score_cache.
// Run: node scripts/ingest-entity.mjs   (re-runnable; upserts, keeps first_seen)
//
// Sources: dawsbot/eth-labels (accounts + tokens, chains 1 + 8453), OFAC (0xB10C),
// ScamSniffer, MEW darklist, and two curated hardcoded sets (DEX routers +
// Tornado / Base predeploys) that are the only reason Base coverage isn't zero.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL || readEnv();
function readEnv() {
  try {
    const m = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}
if (!url) {
  console.error("No DATABASE_URL");
  process.exit(1);
}
const sql = neon(url);
console.log("endpoint:", url.includes("-pooler") ? "POOLED (PgBouncer)" : "DIRECT");

const isEvm = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const lc = (a) => a.toLowerCase();
const CHAIN = { 1: "ethereum", 8453: "base" };

async function getJson(u) {
  const r = await fetch(u, { headers: { "user-agent": "uxus-entity-ingest" } });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.json();
}
async function getText(u) {
  const r = await fetch(u, { headers: { "user-agent": "uxus-entity-ingest" } });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.text();
}

// upsert into entity_labels ONLY. Chunked UNNEST. Keeps first_seen.
// Dedups on (address, chain, source) — last wins — so a single ON CONFLICT
// batch never touches the same PK twice.
async function upsert(rows) {
  const seen = new Map();
  for (const r of rows) seen.set(`${r.address}|${r.chain}|${r.source}`, r);
  rows = [...seen.values()];
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const c = rows.slice(i, i + 500);
    await sql`
      INSERT INTO entity_labels (address, chain, label, category, source)
      SELECT * FROM UNNEST(
        ${c.map((r) => r.address)}::text[],
        ${c.map((r) => r.chain)}::text[],
        ${c.map((r) => (r.label || "").slice(0, 400))}::text[],
        ${c.map((r) => r.category)}::text[],
        ${c.map((r) => r.source)}::text[]
      )
      ON CONFLICT (address, chain, source)
      DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category
    `;
    n += c.length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// eth-labels category derivation
// ---------------------------------------------------------------------------
const CEX_SLUGS = new Set([
  "binance", "coinbase", "kraken", "okx", "bybit", "kucoin", "bitget", "gate", "gate-io", "gemini",
  "bitfinex", "crypto-com", "htx", "huobi", "mexc", "bitstamp", "upbit", "bithumb", "deribit",
  "bilaxy", "phemex", "whitebit", "bingx", "bitmex", "poloniex", "bittrex", "cex-io", "nexo",
  "wazirx", "coinone", "korbit", "paribu", "luno", "bitso", "lbank", "ascendex", "digifinex",
  "latoken", "hotbit", "bitmart", "xt-com", "weex",
]);
const DEX_SLUGS = new Set([
  "uniswap", "sushiswap", "pancakeswap", "curve-fi", "curve-finance", "balancer", "1inch",
  "0x-protocol", "kyberswap", "aerodrome", "baseswap", "paraswap", "cow-protocol", "dodo",
  "bancor", "maverick", "velodrome", "camelot", "odos", "matcha", "solidly", "ambient",
]);
const BRIDGE_SLUGS = new Set([
  "wormhole", "stargate", "synapse", "hop-protocol", "across-protocol", "celer-network",
  "debridge", "multichain", "layerzero", "connext", "axelar", "allbridge", "orbiter", "symbiosis",
]);
// individual EOAs / generic tags with no entity-attribution value
const SKIP_SLUGS = new Set([
  "mev-bot", "friend-tech-users", "airdrop-hunter", "genesis-address", "sybil-delegate",
  "proposer-fee-recipient", "buidlguidl-builders", "retropgf-recipient", "contract-deployer",
  "old-contract", "deprecated", "parity-bug", "take-action", "dust", "nonprofit", "charity",
]);

function bestLabel(tags, fallback) {
  return (tags.find((t) => t.includes(":")) || tags[0] || fallback || "").slice(0, 400);
}

// rows: [{label, nameTag}] for one (address, chain). -> {category, label} or null (skip)
function deriveEntity(rows) {
  const slugs = rows.map((r) => (r.label || "").toLowerCase()).filter(Boolean);
  const tags = rows.map((r) => r.nameTag || "").filter(Boolean);
  const nt = tags.join(" | ").toLowerCase();
  const has = (s) => slugs.includes(s);
  const anySet = (set) => slugs.some((s) => set.has(s));
  const match = (re) => slugs.some((s) => re.test(s));

  if (match(/^(blocked|ofac-sanctions-lists|ofac-sanctioned|sanctioned)$/))
    return { category: "sanctioned", label: bestLabel(tags, "OFAC / blocked") };
  if (match(/(exploit$|-hack$|contract-vulnerability$|^heist$)/))
    return { category: "scam", label: bestLabel(tags, "exploit") };
  if (has("phish-hack") || match(/phish/))
    return { category: "phishing", label: bestLabel(tags, "phishing") };
  if (match(/^(mixer|tornado-cash|typhoon-cash|ethereum-mixer)$/))
    return { category: "mixer", label: bestLabel(tags, "mixer") };
  if (has("bridge") || anySet(BRIDGE_SLUGS)) return { category: "bridge", label: bestLabel(tags, "bridge") };
  if (has("exchange") || anySet(CEX_SLUGS)) return { category: "exchange", label: bestLabel(tags, "exchange") };
  if (anySet(DEX_SLUGS) || has("dex") || has("dex-ag") || has("dex-trade")) {
    if (/\brouter\b/.test(nt)) return { category: "dex_router", label: bestLabel(tags, "DEX router") };
    return { category: "protocol", label: bestLabel(tags, "DEX protocol") };
  }
  if (has("bridged-token") || has("token-contract"))
    return { category: "token_contract", label: bestLabel(tags, "token contract") };
  const named = slugs.filter((s) => !SKIP_SLUGS.has(s));
  if (named.length) return { category: "protocol", label: bestLabel(tags, named[0]) };
  return null;
}

// ---------------------------------------------------------------------------
// Curated hardcoded sets
// ---------------------------------------------------------------------------
const CURATED = [
  // DEX routers — Base
  ["base", "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", "dex_router", "Aerodrome: Router"],
  ["base", "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5", "dex_router", "Aerodrome: Slipstream Router"],
  ["base", "0x6fF5693b99212Da76ad316178A184AB56D299b43", "dex_router", "Uniswap: Universal Router (Base)"],
  ["base", "0x2626664c2603336E57B271c5C0b26F421741e481", "dex_router", "Uniswap: SwapRouter02 (Base)"],
  ["base", "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", "dex_router", "Uniswap: V2 Router 02 (Base)"],
  ["base", "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86", "dex_router", "BaseSwap: Router"],
  ["base", "0x0389879e0156033202C44BF784ac18fC02edeE4f", "dex_router", "SushiSwap: RouteProcessor (Base)"],
  ["base", "0x1b81D678ffb9C0263b24A97847620C99d213eB14", "dex_router", "PancakeSwap: Smart Router (Base)"],
  ["base", "0x111111125421cA6dc452d289314280a0f8842A65", "dex_router", "1inch: Aggregation Router V6"],
  ["base", "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", "dex_router", "KyberSwap: MetaAggregationRouter V2"],
  ["base", "0x19cEeAd7105607Cd444F5ad10dd51356436095a1", "dex_router", "Odos: Router V2 (Base)"],
  // DEX routers — Ethereum
  ["ethereum", "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", "dex_router", "Uniswap: Universal Router"],
  ["ethereum", "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", "dex_router", "Uniswap: Universal Router (v3)"],
  ["ethereum", "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "dex_router", "Uniswap: SwapRouter02"],
  ["ethereum", "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", "dex_router", "Uniswap: V2 Router 02"],
  ["ethereum", "0x111111125421cA6dc452d289314280a0f8842A65", "dex_router", "1inch: Aggregation Router V6"],
  ["ethereum", "0x1111111254EEB25477B68fb85Ed929f73A960582", "dex_router", "1inch: Aggregation Router V5"],
  ["ethereum", "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", "dex_router", "0x: Exchange Proxy"],
  ["ethereum", "0x9008D19f58AAbD9eD0D60971565AA8510560ab41", "dex_router", "CoW Protocol: GPv2 Settlement"],
  ["ethereum", "0x6A000F20005980200259B80c5102003040001068", "dex_router", "ParaSwap: Augustus Swapper V6"],
  ["ethereum", "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", "dex_router", "KyberSwap: MetaAggregationRouter V2"],
  ["ethereum", "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D", "dex_router", "Curve: Router"],
  // Tornado Cash — Ethereum
  ["ethereum", "0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc", "mixer", "Tornado.Cash: 0.1 ETH"],
  ["ethereum", "0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936", "mixer", "Tornado.Cash: 1 ETH"],
  ["ethereum", "0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF", "mixer", "Tornado.Cash: 10 ETH"],
  ["ethereum", "0xA160cdAB225685dA1d56aa342Ad8841c3b53f291", "mixer", "Tornado.Cash: 100 ETH"],
  ["ethereum", "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b", "mixer", "Tornado.Cash: Router"],
  ["ethereum", "0x722122dF12D4e14e13Ac3b6895a86e84145b6967", "mixer", "Tornado.Cash: Proxy"],
  ["ethereum", "0x905b63Fff465B9fFBF41DeA908CEb12478ec7601", "mixer", "Tornado.Cash: Old Proxy"],
  ["ethereum", "0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3", "mixer", "Tornado.Cash: 100 DAI"],
  ["ethereum", "0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144", "mixer", "Tornado.Cash: 1,000 DAI"],
  ["ethereum", "0x07687e702b410Fa43f4cB4Af7FA097918ffD2730", "mixer", "Tornado.Cash: 10,000 DAI"],
  ["ethereum", "0x23773E65ed146A459791799d01336DB287f25334", "mixer", "Tornado.Cash: 100,000 DAI"],
  // Base OP-Stack predeploys + bridge (addresses from viem/chains)
  ["base", "0x4200000000000000000000000000000000000010", "bridge", "Base: L2 Standard Bridge"],
  ["base", "0x4200000000000000000000000000000000000016", "bridge", "Base: L2-to-L1 Message Passer"],
  ["base", "0x4200000000000000000000000000000000000007", "bridge", "Base: L2 Cross Domain Messenger"],
  ["base", "0x4200000000000000000000000000000000000014", "bridge", "Base: L2 ERC-721 Bridge"],
  ["base", "0x4200000000000000000000000000000000000006", "token_contract", "Wrapped Ether (WETH, Base)"],
  ["base", "0x420000000000000000000000000000000000000F", "protocol", "Base: Gas Price Oracle"],
  ["base", "0x4200000000000000000000000000000000000015", "protocol", "Base: L1Block"],
  ["ethereum", "0x3154Cf16ccdb4C6d922629664174b904d80F2C35", "bridge", "Base: L1 Standard Bridge"],
  ["ethereum", "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e", "bridge", "Base: L1 Portal (OptimismPortal)"],
  ["ethereum", "0x866E82a600A1414e583f7F13623F1aC5d58b0Afa", "bridge", "Base: L1 Cross Domain Messenger"],
  // key tokens
  ["base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "token_contract", "Circle: USDC (Base, native)"],
  ["base", "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", "token_contract", "Bridged USDC (USDbC, Base)"],
  ["base", "0x940181a94A35A4569E4529A3CDfB74e38FD98631", "token_contract", "Aerodrome: AERO Token"],
  ["base", "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", "token_contract", "Coinbase Wrapped Staked ETH (cbETH, Base)"],
  ["ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "token_contract", "Circle: USDC (Ethereum)"],
];

// ---------------------------------------------------------------------------
const results = {};

// 1) eth-labels — accounts
try {
  const A = await getJson("https://raw.githubusercontent.com/dawsbot/eth-labels/v1/data/json/accounts.json");
  const groups = new Map(); // "chainId:addr" -> [{label,nameTag}]
  for (const r of A) {
    if (!CHAIN[r.chainId] || !isEvm(r.address)) continue;
    const k = r.chainId + ":" + lc(r.address);
    (groups.get(k) || groups.set(k, []).get(k)).push({ label: r.label, nameTag: r.nameTag });
  }
  const rows = [];
  for (const [k, rs] of groups) {
    const [cid, addr] = k.split(":");
    const e = deriveEntity(rs);
    if (e) rows.push({ address: addr, chain: CHAIN[cid], label: e.label, category: e.category, source: "eth-labels" });
  }
  await upsert(rows);
  results["eth-labels/accounts"] = `${groups.size} addrs -> ${rows.length} labeled`;
} catch (e) {
  results["eth-labels/accounts"] = `ERR ${e.message}`;
}

// 2) eth-labels — tokens
try {
  const T = await getJson("https://raw.githubusercontent.com/dawsbot/eth-labels/v1/data/json/tokens.json");
  const seen = new Set();
  const rows = [];
  for (const r of T) {
    if (!CHAIN[r.chainId] || !isEvm(r.address)) continue;
    const k = r.chainId + ":" + lc(r.address);
    if (seen.has(k)) continue;
    seen.add(k);
    const nm = [r.name, r.symbol && `(${r.symbol})`].filter(Boolean).join(" ") || r.label || "token";
    rows.push({ address: lc(r.address), chain: CHAIN[r.chainId], label: nm, category: "token_contract", source: "eth-labels" });
  }
  await upsert(rows);
  results["eth-labels/tokens"] = `${rows.length} token contracts`;
} catch (e) {
  results["eth-labels/tokens"] = `ERR ${e.message}`;
}

// 3) OFAC (0xB10C) — sanctioned
try {
  const txt = await getText("https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt");
  const rows = txt.split(/\r?\n/).map((s) => s.trim()).filter(isEvm)
    .map((a) => ({ address: lc(a), chain: "evm", label: "OFAC SDN List", category: "sanctioned", source: "ofac" }));
  await upsert(rows);
  results.ofac = rows.length;
} catch (e) {
  results.ofac = `ERR ${e.message}`;
}

// 4) ScamSniffer — scam
try {
  const arr = await getJson("https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json");
  const list = Array.isArray(arr) ? arr : Object.keys(arr || {});
  const rows = list.map(String).filter(isEvm)
    .map((a) => ({ address: lc(a), chain: "evm", label: "ScamSniffer blacklist", category: "scam", source: "scamsniffer" }));
  await upsert(rows);
  results.scamsniffer = rows.length;
} catch (e) {
  results.scamsniffer = `ERR ${e.message}`;
}

// 5) MEW darklist — phishing / scam / drainer (from the comment)
try {
  const arr = await getJson("https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json");
  const cat = (c) => {
    const s = (c || "").toLowerCase();
    if (/drain/.test(s)) return "drainer";
    if (/phish/.test(s)) return "phishing";
    return "scam";
  };
  const rows = (Array.isArray(arr) ? arr : []).filter((o) => o && isEvm(o.address))
    .map((o) => ({ address: lc(o.address), chain: "evm", label: (o.comment || "MEW darklist").slice(0, 400), category: cat(o.comment), source: "mew" }));
  await upsert(rows);
  results.mew = rows.length;
} catch (e) {
  results.mew = `ERR ${e.message}`;
}

// 6) Curated
try {
  const rows = CURATED.map(([chain, address, category, label]) => ({ address: lc(address), chain, label, category, source: "curated" }));
  await upsert(rows);
  results.curated = rows.length;
} catch (e) {
  results.curated = `ERR ${e.message}`;
}

console.log("\nIngest results:", results);
const total = await sql`SELECT count(*)::int AS n FROM entity_labels`;
const byCat = await sql`SELECT chain, category, count(*)::int AS n FROM entity_labels GROUP BY chain, category ORDER BY chain, n DESC`;
console.log("\nBy chain/category:");
for (const r of byCat) console.log(`  ${r.chain.padEnd(9)} ${r.category.padEnd(16)} ${r.n}`);
console.log("\nTOTAL entity_labels:", total[0].n);
