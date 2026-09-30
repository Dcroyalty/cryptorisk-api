// lib/x402v2/flag.ts — feature flag + self-tripping kill switch for the
// multi-rail (x402 v2: Base + Polygon + Solana) routes under /api/v2/*.
//
// The v1 Base routes (/api/risk/pro etc., gated by middleware.ts) are NEVER
// affected by anything in this directory. When multi-rail is disabled, a
// /api/v2/* request is 307-redirected to its v1 twin, so a buyer always lands
// on the proven Base rail.
//
// X402_MULTIRAIL (env, read per request):
//   unset / anything else -> OFF (default)
//   "test"                -> on ONLY for requests carrying
//                            `x-uxus-rail-test: <X402_MULTIRAIL_TEST_TOKEN>`
//   "on"                  -> on for everyone
//
// Kill switch: infrastructure errors (facilitator 5xx/timeout/unreachable,
// route validation against the facilitator failing, unexpected throws) are
// logged to x402_rail_errors. TRIP_THRESHOLD of them within TRIP_WINDOW_MIN
// minutes trips x402_rail_state, which forces OFF for every instance until a
// human clears it:  UPDATE x402_rail_state SET tripped_at = NULL, reason = NULL;
// A tripped rail is a RED watchdog check (healthchecks.io emails you).
// Buyer-side problems (bad signature, insufficient funds) never count.
import { sql } from "@/lib/db";

export type RailMode = "off" | "test" | "on";

const TRIP_THRESHOLD = 3;
const TRIP_WINDOW_MIN = 10;
const STATE_CACHE_MS = 15_000;

export function configuredMode(): RailMode {
  const v = (process.env.X402_MULTIRAIL || "").trim().toLowerCase();
  return v === "on" ? "on" : v === "test" ? "test" : "off";
}

function testTokenMatches(req: Request): boolean {
  const want = process.env.X402_MULTIRAIL_TEST_TOKEN || "";
  const got = req.headers.get("x-uxus-rail-test") || "";
  return want.length >= 16 && got === want;
}

let ensured = false;
async function ensureTables() {
  if (ensured) return;
  await sql`CREATE TABLE IF NOT EXISTS x402_rail_state (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), tripped_at timestamptz, reason text)`;
  await sql`CREATE TABLE IF NOT EXISTS x402_rail_errors (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, detail text)`;
  ensured = true;
}

export interface Tripped {
  at: string;
  reason: string;
}

let cache: { at: number; tripped: Tripped | null } | null = null;

/** Current kill-switch state. On a DB error, fail CLOSED (treat as tripped) — v1 still serves. */
export async function trippedState(): Promise<Tripped | null> {
  if (cache && Date.now() - cache.at < STATE_CACHE_MS) return cache.tripped;
  try {
    await ensureTables();
    const [r] = (await sql`SELECT tripped_at, reason FROM x402_rail_state WHERE id = 1 AND tripped_at IS NOT NULL`) as {
      tripped_at: string;
      reason: string;
    }[];
    const tripped = r ? { at: new Date(r.tripped_at).toISOString(), reason: r.reason } : null;
    cache = { at: Date.now(), tripped };
    return tripped;
  } catch (e) {
    return { at: new Date().toISOString(), reason: `kill-switch state unreadable: ${(e as Error)?.message ?? e}` };
  }
}

/** Is multi-rail live for THIS request? */
export async function multiRailEnabled(req: Request): Promise<boolean> {
  const mode = configuredMode();
  if (mode === "off") return false;
  if (mode === "test" && !testTokenMatches(req)) return false;
  return (await trippedState()) === null;
}

/** Log an infrastructure error; trip the switch at the threshold. Never throws. */
export async function recordRailError(kind: string, detail: string): Promise<void> {
  console.error(`[x402v2] ${kind}: ${detail}`);
  try {
    await ensureTables();
    await sql`INSERT INTO x402_rail_errors (kind, detail) VALUES (${kind}, ${detail.slice(0, 1000)})`;
    const [{ n }] = (await sql`
      SELECT count(*)::int AS n FROM x402_rail_errors WHERE at > now() - ${`${TRIP_WINDOW_MIN} minutes`}::interval
    `) as { n: number }[];
    if (n >= TRIP_THRESHOLD) {
      await sql`
        INSERT INTO x402_rail_state (id, tripped_at, reason) VALUES (1, now(), ${`${n} errors in ${TRIP_WINDOW_MIN} min; last: ${kind}: ${detail}`.slice(0, 1000)})
        ON CONFLICT (id) DO UPDATE SET tripped_at = COALESCE(x402_rail_state.tripped_at, EXCLUDED.tripped_at),
          reason = COALESCE(x402_rail_state.reason, EXCLUDED.reason)
      `;
      cache = null;
      console.error(`[x402v2] KILL SWITCH TRIPPED after ${n} errors`);
    }
  } catch (e) {
    console.error("[x402v2] could not record rail error", (e as Error)?.message ?? e);
  }
}
