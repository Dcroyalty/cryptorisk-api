// scripts/schema.mjs — create tables in Neon. Run once: node scripts/schema.mjs
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL || readEnv();
function readEnv() {
  try { const m = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m); return m ? m[1].trim().replace(/^["']|["']$/g,"") : null; } catch { return null; }
}
if (!url) { console.error("No DATABASE_URL in .env"); process.exit(1); }

const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS bad_addresses (
    address     TEXT NOT NULL,
    chain       TEXT NOT NULL DEFAULT 'evm',
    source      TEXT NOT NULL,
    category    TEXT NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (address, source)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_bad_addr ON bad_addresses (address)`;

await sql`
  CREATE TABLE IF NOT EXISTS score_cache (
    address     TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const counts = await sql`SELECT count(*)::int AS n FROM bad_addresses`;
console.log("Schema ready. bad_addresses rows:", counts[0].n);
