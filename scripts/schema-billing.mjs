// scripts/schema-billing.mjs — creates the api_keys table ONLY.
// Stripe-subscription-backed API keys: Stripe drives plan/status, this table
// is the local mirror lib/keys.ts's guard() reads and writes.
// Run once: node scripts/schema-billing.mjs
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

// key is stored raw (matches the shield_sessions.token convention in this repo)
// rather than hashed — the guard() lookup is a direct equality match.
await sql`
  CREATE TABLE IF NOT EXISTS api_keys (
    key                    TEXT PRIMARY KEY,
    stripe_customer_id     TEXT NOT NULL,
    stripe_subscription_id TEXT NOT NULL UNIQUE,
    plan                   TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'canceled'
    quota_limit            INT NOT NULL,
    usage_count            INT NOT NULL DEFAULT 0,
    period_start           TIMESTAMPTZ NOT NULL,
    period_end             TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_customer ON api_keys (stripe_customer_id)`;

const [{ n }] = await sql`SELECT count(*)::int AS n FROM api_keys`;
console.log("Schema ready. api_keys rows:", n);
