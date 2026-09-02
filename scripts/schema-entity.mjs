// scripts/schema-entity.mjs — creates the entity_labels table ONLY.
// NEVER touches bad_addresses or score_cache (live production revenue).
// Run once: node scripts/schema-entity.mjs
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
  console.error("No DATABASE_URL in .env");
  process.exit(1);
}
const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS entity_labels (
    address     TEXT NOT NULL,
    chain       TEXT NOT NULL,   -- 'ethereum' | 'base' | 'evm' (chain-agnostic sources)
    label       TEXT NOT NULL,   -- human name, e.g. "Tornado.Cash: 1 ETH", "Binance 14"
    category    TEXT NOT NULL,   -- sanctioned | mixer | exchange | bridge | dex_router | scam
                                 -- | drainer | phishing | token_contract | protocol | unknown
    source      TEXT NOT NULL,   -- 'eth-labels' | 'ofac' | 'scamsniffer' | 'mew' | 'curated'
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (address, chain, source)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_entity_labels_addr ON entity_labels (address, chain)`;

const [{ n }] = await sql`SELECT count(*)::int AS n FROM entity_labels`;
console.log("entity_labels ready. rows:", n);
