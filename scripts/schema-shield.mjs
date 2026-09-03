// scripts/schema-shield.mjs — creates the shield_* tables ONLY.
// NEVER touches bad_addresses / score_cache / entity_labels (all live).
// Run once: node scripts/schema-shield.mjs
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

// per-user private blocklist. Blocks are address-wide (chain is annotation only).
await sql`
  CREATE TABLE IF NOT EXISTS shield_blocks (
    owner           TEXT NOT NULL,
    blocked_address TEXT NOT NULL,
    chain           TEXT NOT NULL DEFAULT 'evm',
    reason          TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'auto' (inert in v1)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, blocked_address)
  )
`;

// per-user private allowlist: "I vouch for this address — do not auto-block it for me"
await sql`
  CREATE TABLE IF NOT EXISTS shield_allows (
    owner      TEXT NOT NULL,
    address    TEXT NOT NULL,
    reason     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, address)
  )
`;

// the stats trail. 90-day retention, pruned opportunistically.
await sql`
  CREATE TABLE IF NOT EXISTS shield_events (
    owner          TEXT NOT NULL,
    address        TEXT NOT NULL,
    action         TEXT NOT NULL,   -- 'blocked' | 'screened' | 'allowed'
    recommendation TEXT,            -- ANSWER | SCREEN | BLOCK | null
    category       TEXT,            -- entity category at check time
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_shield_events_owner_time ON shield_events (owner, created_at DESC)`;

// one outstanding sign-in challenge per owner
await sql`
  CREATE TABLE IF NOT EXISTS shield_nonces (
    owner      TEXT PRIMARY KEY,
    nonce      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )
`;

// read sessions (bearer token) so /check is not a signing prompt per message
await sql`
  CREATE TABLE IF NOT EXISTS shield_sessions (
    token      TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_shield_sessions_owner ON shield_sessions (owner)`;

for (const t of ["shield_blocks", "shield_allows", "shield_events", "shield_nonces", "shield_sessions"]) {
  const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM ${t}`);
  console.log(`${t.padEnd(18)} ok, rows: ${n}`);
}
