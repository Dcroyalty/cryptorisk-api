// lib/watchdog.ts — daily health sweep, run by /api/cron/watchdog.
//
// Turns every "this quietly broke" failure mode into a /fail ping on
// HEALTHCHECK_PING_URL (healthchecks.io emails it — the only alert channel):
//   • cron heartbeats — refresh-lists and the Shield sweep ran and succeeded
//   • OFAC — DB is in exact parity with upstream; upstream feed itself alive
//   • scam lists — every upstream address is in the DB
//   • Shield retention — nothing older than 90 days survives
//   • payment rails — live 402 challenge names our payTo on Base; the CDP
//     facilitator answers /supported for base/exact; Stripe account can charge
//     and the billing webhook is enabled
//   • Apify actors — not deprecated / under maintenance, no failed runs
//   • XRPL node ring — majority exists, no amendment-blocked nodes
//   • things that run out/expire — Neon storage, the uxus.finance domain,
//     prepaid OpenRouter + Serper credit
//
// Each check is independent and time-boxed; one hanging upstream can't take
// down the others. A check that can't be performed is "warn", never "ok".
import { sql } from "@/lib/db";
import { readRuns, type Job } from "@/lib/cron-runs";
import { MIN_OFAC, OFAC_URL, SCAMSNIFFER_URL, MEW_URL } from "@/lib/refresh-lists";
import { EVENT_RETENTION_DAYS } from "@/lib/shield";
import { sweepNodeHealth } from "@/lib/xrpl-nodes";
import { stripe, STRIPE_ENABLED } from "@/lib/stripe";
import { PAY_TO, CANONICAL_ORIGIN } from "@/lib/pay-to";
import { deadMansSwitchArmed } from "@/lib/notify";
import { configuredMode, trippedState } from "@/lib/x402v2/flag";
import { validateRails, solanaPayTo } from "@/lib/x402v2/server";
import { facilitator } from "@coinbase/x402";

export type Level = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  level: Level;
  detail: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Vercel runs a daily cron somewhere inside its scheduled hour; 26h of slack
// means one late run never alerts, but a single skipped day always does.
const HEARTBEAT_MAX_AGE_MS = 26 * HOUR;
const OFAC_UPSTREAM_STALE_DAYS = 60; // the feed commits every ~2-3 weeks when OFAC changes
const NEON_LIMIT_BYTES = 512 * 1024 * 1024; // Neon free-tier branch cap (project setting)
const DOMAIN = "uxus.finance";
const APIFY_ACTORS = ["uxus.finance~google-search-serp-scraper", "uxus.finance~wallet-sanctions-risk-screener"];

const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

async function getJson(url: string, init: RequestInit = {}, ms = 15_000): Promise<any> {
  const headers = { "user-agent": "uxus-watchdog (+https://uxus.finance)", ...(init.headers as Record<string, string>) };
  const r = await fetch(url, { cache: "no-store", ...init, headers, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / HOUR;
  return h < 48 ? `${h.toFixed(1)}h ago` : `${(h / 24).toFixed(1)}d ago`;
}

// ── individual checks ──────────────────────────────────────────────────────

async function checkHeartbeats(): Promise<Check[]> {
  const runs = await readRuns();
  const jobs: Array<[Job, string]> = [
    ["refresh-lists", "OFAC + scam list refresh"],
    ["shield-sweep", "Shield 90-day retention sweep"],
  ];
  return jobs.map(([job, what]) => {
    const r = runs.get(job);
    const name = `cron:${job}`;
    if (!r) return { name, level: "warn", detail: `${what} has no heartbeat yet (first run after deploy is 06:00 UTC).` };
    const okAge = r.last_ok_at ? Date.now() - Date.parse(r.last_ok_at) : Infinity;
    if (!r.ok) return { name, level: "fail", detail: `${what} FAILED on its last run (${ago(r.last_run_at)}): ${JSON.stringify(r.detail).slice(0, 300)}` };
    if (okAge > HEARTBEAT_MAX_AGE_MS) return { name, level: "fail", detail: `${what} last succeeded ${ago(r.last_ok_at)} — the cron is not running.` };
    return { name, level: "ok", detail: `${what} succeeded ${ago(r.last_ok_at)}.` };
  });
}

async function checkOfac(): Promise<Check[]> {
  const out: Check[] = [];
  const db = (await sql`SELECT address FROM bad_addresses WHERE source = 'ofac'`) as { address: string }[];
  const dbSet = new Set(db.map((r) => r.address));
  if (dbSet.size < MIN_OFAC) {
    out.push({ name: "ofac:db", level: "fail", detail: `Only ${dbSet.size} OFAC addresses in the DB (< ${MIN_OFAC}). Sanctions screening is compromised.` });
  }
  try {
    const r = await fetch(OFAC_URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const up = new Set((await r.text()).split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(isEvm));
    const missing = [...up].filter((a) => !dbSet.has(a));
    const extra = [...dbSet].filter((a) => !up.has(a));
    if (up.size >= MIN_OFAC && (missing.length || extra.length)) {
      out.push({
        name: "ofac:parity",
        level: "fail",
        detail: `DB differs from the live OFAC list: ${missing.length} sanctioned address(es) missing, ${extra.length} delisted still present. The refresh cron is not keeping up.`,
      });
    } else if (dbSet.size >= MIN_OFAC) {
      out.push({ name: "ofac:parity", level: "ok", detail: `DB matches the live OFAC list exactly (${dbSet.size} addresses).` });
    }
  } catch (e) {
    out.push({ name: "ofac:parity", level: "warn", detail: `Could not fetch the OFAC list to compare: ${(e as Error).message}` });
  }
  try {
    const c = await getJson(
      "https://api.github.com/repos/0xB10C/ofac-sanctioned-digital-currency-addresses/commits?sha=lists&per_page=1",
      { headers: { "user-agent": "uxus-watchdog", accept: "application/vnd.github+json" } },
    );
    const last = c?.[0]?.commit?.committer?.date as string | undefined;
    const days = last ? (Date.now() - Date.parse(last)) / DAY : Infinity;
    out.push(
      days > OFAC_UPSTREAM_STALE_DAYS
        ? { name: "ofac:upstream", level: "warn", detail: `The OFAC feed (0xB10C) last updated ${ago(last)} — it normally updates every 2-3 weeks. It may have stopped; check the repo and consider another source.` }
        : { name: "ofac:upstream", level: "ok", detail: `OFAC feed last updated ${ago(last)}.` },
    );
  } catch (e) {
    out.push({ name: "ofac:upstream", level: "warn", detail: `Could not check the OFAC feed's last update: ${(e as Error).message}` });
  }
  return out;
}

async function checkScamLists(): Promise<Check[]> {
  const feeds: Array<[string, string, (raw: any) => string[]]> = [
    ["scamsniffer", SCAMSNIFFER_URL, (raw) => (Array.isArray(raw) ? raw : Object.keys(raw || {})).map(String)],
    ["mew", MEW_URL, (raw) => (Array.isArray(raw) ? raw : []).map((o: any) => o?.address).filter(Boolean)],
  ];
  return Promise.all(
    feeds.map(async ([source, url, parse]): Promise<Check> => {
      const name = `list:${source}`;
      try {
        const up = [...new Set(parse(await getJson(url)).filter(isEvm).map((a) => a.toLowerCase()))];
        if (!up.length) return { name, level: "warn", detail: `${source} upstream returned 0 addresses.` };
        const have = (await sql`
          SELECT count(*)::int AS n FROM bad_addresses WHERE source = ${source} AND address = ANY(${up}::text[])
        `)[0].n as number;
        const missing = up.length - have;
        return missing > 0
          ? { name, level: "warn", detail: `${missing} of ${up.length} ${source} addresses are not in the DB yet (next refresh picks them up if the cron is healthy).` }
          : { name, level: "ok", detail: `All ${up.length} ${source} addresses present.` };
      } catch (e) {
        return { name, level: "warn", detail: `Could not compare ${source}: ${(e as Error).message}` };
      }
    }),
  );
}

async function checkShieldRetention(): Promise<Check> {
  const r = (await sql`
    SELECT
      (SELECT count(*)::int FROM shield_events WHERE created_at < now() - ${`${EVENT_RETENTION_DAYS + 2} days`}::interval) AS old_events,
      (SELECT count(*)::int FROM shield_nonces WHERE expires_at < now() - interval '2 days') AS stale_nonces,
      (SELECT count(*)::int FROM shield_sessions WHERE expires_at < now() - interval '2 days') AS stale_sessions
  `)[0] as { old_events: number; stale_nonces: number; stale_sessions: number };
  const bad = r.old_events + r.stale_nonces + r.stale_sessions;
  return bad
    ? { name: "shield:retention", level: "fail", detail: `Retention not enforced: ${r.old_events} events > ${EVENT_RETENTION_DAYS}d, ${r.stale_nonces} stale nonces, ${r.stale_sessions} stale sessions. The sweep is not running.` }
    : { name: "shield:retention", level: "ok", detail: `Nothing older than ${EVENT_RETENTION_DAYS} days retained.` };
}

async function checkX402Challenge(): Promise<Check> {
  const name = "pay:x402-challenge";
  try {
    const r = await fetch(`${CANONICAL_ORIGIN}/api/risk/pro?address=0x0000000000000000000000000000000000000000`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status !== 402) return { name, level: "fail", detail: `/api/risk/pro returned ${r.status}, expected 402 — the paywall is not serving.` };
    const j = await r.json();
    const a = j?.accepts?.[0];
    const problems: string[] = [];
    if (String(a?.payTo || "").toLowerCase() !== PAY_TO) problems.push(`payTo is ${a?.payTo}`);
    if (a?.network !== "base") problems.push(`network is ${a?.network}`);
    if (a?.maxAmountRequired !== "10000") problems.push(`price is ${a?.maxAmountRequired} atomic`);
    if (!r.headers.get("payment-required")) problems.push("PAYMENT-REQUIRED header missing");
    return problems.length
      ? { name, level: "fail", detail: `402 challenge is wrong: ${problems.join("; ")}.` }
      : { name, level: "ok", detail: `402 challenge names ${PAY_TO} on base at $0.01.` };
  } catch (e) {
    return { name, level: "fail", detail: `Could not reach the paywall: ${(e as Error).message}` };
  }
}

async function checkCdpFacilitator(): Promise<Check> {
  const name = "pay:cdp-facilitator";
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
    return { name, level: "fail", detail: "CDP_API_KEY_ID / CDP_API_KEY_SECRET not set — x402 payments cannot verify or settle." };
  }
  try {
    const headers = (await facilitator.createAuthHeaders!()) as Record<string, Record<string, string>>;
    const j = await getJson(`${facilitator.url}/supported`, { headers: headers.supported });
    const kinds: Array<{ network?: string; scheme?: string; x402Version?: number }> = j?.kinds ?? [];
    const has = (v: number, net: string) => kinds.some((k) => k.scheme === "exact" && k.x402Version === v && k.network === net);
    const base = kinds.some((k) => k.scheme === "exact" && (k.network === "base" || k.network === "eip155:8453"));
    // The multi-rail (v2) routes also need these; reported here so it's visible even while the flag is off.
    const v2 = `v2 exact: base ${has(2, "eip155:8453")}, polygon ${has(2, "eip155:137")}, solana ${has(2, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")}`;
    return base
      ? { name, level: "ok", detail: `CDP facilitator is up and supports exact/base (${kinds.length} kinds; ${v2}).` }
      : { name, level: "fail", detail: `CDP facilitator answered but no longer lists exact on base: ${JSON.stringify(kinds).slice(0, 300)}` };
  } catch (e) {
    return { name, level: "fail", detail: `CDP facilitator /supported failed (auth or outage): ${(e as Error).message}. Paid calls are returning 503 until it recovers.` };
  }
}

async function checkStripe(): Promise<Check[]> {
  if (!STRIPE_ENABLED) return [{ name: "pay:stripe", level: "ok", detail: "Stripe disabled (keys not set) — pricing page shows Coming soon." }];
  const out: Check[] = [];
  try {
    const acct = await stripe().accounts.retrieveCurrent(undefined, { timeout: 15_000 });
    const due = acct.requirements?.currently_due ?? [];
    const pastDue = acct.requirements?.past_due ?? [];
    const deadline = acct.requirements?.current_deadline;
    if (!acct.charges_enabled || pastDue.length) {
      out.push({ name: "pay:stripe-account", level: "fail", detail: `Stripe cannot charge (charges_enabled=${acct.charges_enabled}); past_due: ${pastDue.join(", ") || "none"}.` });
    } else if (due.length || !acct.payouts_enabled) {
      out.push({
        name: "pay:stripe-account",
        level: "warn",
        detail: `Stripe needs information${deadline ? ` by ${new Date(deadline * 1000).toISOString().slice(0, 10)}` : ""}: ${due.join(", ") || "(none listed)"}; payouts_enabled=${acct.payouts_enabled}. Log in to Stripe.`,
      });
    } else {
      out.push({ name: "pay:stripe-account", level: "ok", detail: "Stripe account can charge and pay out; nothing due." });
    }
  } catch (e) {
    out.push({ name: "pay:stripe-account", level: "fail", detail: `Stripe API unreachable or key revoked: ${(e as Error).message}` });
  }
  try {
    const hooks = await stripe().webhookEndpoints.list({ limit: 50 }, { timeout: 15_000 });
    const ours = hooks.data.filter((h) => h.url.includes("/api/billing/webhook"));
    const enabled = ours.some((h) => h.status === "enabled" && h.url.startsWith(CANONICAL_ORIGIN));
    out.push(
      enabled
        ? { name: "pay:stripe-webhook", level: "ok", detail: "Billing webhook enabled on uxus.finance." }
        : { name: "pay:stripe-webhook", level: "fail", detail: `No enabled Stripe webhook to ${CANONICAL_ORIGIN}/api/billing/webhook (found: ${ours.map((h) => `${h.url}=${h.status}`).join(", ") || "none"}). Paid subscribers will not get keys.` },
    );
  } catch (e) {
    out.push({ name: "pay:stripe-webhook", level: "warn", detail: `Could not list Stripe webhooks: ${(e as Error).message}` });
  }
  return out;
}

async function checkApify(): Promise<Check[]> {
  return Promise.all(
    APIFY_ACTORS.map(async (id): Promise<Check> => {
      const name = `apify:${id.split("~")[1]}`;
      try {
        const a = (await getJson(`https://api.apify.com/v2/acts/${id}`)).data;
        const problems: string[] = [];
        if (!a.isPublic) problems.push("no longer public");
        if (a.isDeprecated) problems.push("DEPRECATED");
        if (a.notice && a.notice !== "NONE") problems.push(`notice=${a.notice}`);
        // The Store's "Under maintenance" badge is only exposed in the actor page's
        // embedded data, not the API. Absent marker = can't tell, not "fine".
        let maint = "unknown";
        try {
          const page = await fetch(`https://apify.com/${id.replace("~", "/")}`, { signal: AbortSignal.timeout(15_000) });
          const m = (await page.text()).match(/\\?"underMaintenanceMessage\\?":\\?"([^"\\]*)/);
          maint = m ? (m[1] === "$undefined" ? "no" : "YES") : "unknown";
        } catch {
          /* leave unknown */
        }
        if (maint === "YES") problems.push("UNDER MAINTENANCE (Apify QA run failed)");
        const s = a.stats?.publicActorRunStats30Days ?? {};
        const failed = (s.FAILED ?? 0) + (s["TIMED-OUT"] ?? 0) + (s.ABORTED ?? 0);
        const summary = `30d runs: ${s.SUCCEEDED ?? 0} ok / ${failed} failed; last run ${ago(a.stats?.lastRunStartedAt)}; maintenance=${maint}`;
        if (problems.length) return { name, level: "fail", detail: `${problems.join("; ")}. ${summary}` };
        if (failed > 0 || maint === "unknown") return { name, level: "warn", detail: summary };
        return { name, level: "ok", detail: summary };
      } catch (e) {
        return { name, level: "warn", detail: `Could not read actor: ${(e as Error).message}` };
      }
    }),
  );
}

async function checkXrpl(): Promise<Check> {
  const s = await sweepNodeHealth();
  if (!s.trusted) {
    return { name: "xrpl:nodes", level: "fail", detail: `No ledger majority across XRPL nodes (${s.responded} responded, largest cluster ${s.clusterSize}). /api/lookup is refusing XRPL reads with 503.` };
  }
  if (s.floorHit || s.responded < 3 || s.amendmentBlocked.length || s.lagging.length) {
    return {
      name: "xrpl:nodes",
      level: "warn",
      detail: `${s.responded} nodes responded; amendment-blocked: ${s.amendmentBlocked.join(", ") || "none"}; lagging: ${s.lagging.map((l) => `${l.host}(-${l.behindBy})`).join(", ") || "none"}${s.floorHit ? "; kept some bad nodes in rotation to stay above the 3-node floor" : ""}. Consider replacing nodes in lib/xrpl-nodes.ts.`,
    };
  }
  return { name: "xrpl:nodes", level: "ok", detail: `${s.responded} nodes agree at ledger ${s.majorityLedgerIndex}.` };
}

// Multi-rail (x402 v2) routes: RED if the kill switch has tripped (v1 Base keeps
// serving, but a human must look and clear it). The server is initialized even
// while the flag is off, so a rail CDP stops supporting shows up before launch.
async function checkMultiRail(): Promise<Check> {
  const name = "x402v2:rails";
  const mode = configuredMode();
  const tripped = await trippedState();
  if (tripped) {
    return {
      name,
      level: "fail",
      detail: `Multi-rail kill switch TRIPPED at ${tripped.at}: ${tripped.reason}. /api/v2/* is falling back to the v1 Base routes. After fixing, clear it: UPDATE x402_rail_state SET tripped_at = NULL, reason = NULL;`,
    };
  }
  try {
    const rails = await validateRails();
    return { name, level: "ok", detail: `mode=${mode}; rails validated against CDP /supported: ${rails.join(", ")}${solanaPayTo() ? "" : " (Solana off: X402_SOLANA_PAY_TO unset)"}.` };
  } catch (e) {
    return {
      name,
      level: mode === "off" ? "warn" : "fail",
      detail: `mode=${mode}; multi-rail server failed to initialize: ${(e as Error)?.message ?? e}`,
    };
  }
}

// Reports only the host shape, never the URL. Serverless functions should use
// Neon's pooled (PgBouncer) endpoint so a traffic spike can't exhaust
// Postgres connections; migrations/DDL scripts may use the direct one.
function checkDbConnection(): Check {
  try {
    const host = new URL(process.env.DATABASE_URL || "").hostname;
    return host.includes("-pooler.")
      ? { name: "db:connection", level: "ok", detail: "DATABASE_URL uses Neon's pooled endpoint." }
      : { name: "db:connection", level: "warn", detail: "DATABASE_URL uses a direct (unpooled) Neon endpoint — switch to the -pooler host for runtime." };
  } catch {
    return { name: "db:connection", level: "fail", detail: "DATABASE_URL is missing or not a URL." };
  }
}

async function checkNeonSize(): Promise<Check> {
  const n = (await sql`SELECT pg_database_size(current_database())::bigint AS b`)[0].b as number | string;
  const pct = (Number(n) / NEON_LIMIT_BYTES) * 100;
  const detail = `Database is ${(Number(n) / 1048576).toFixed(0)} MB of the 512 MB free-tier cap (${pct.toFixed(0)}%).`;
  return { name: "neon:size", level: pct >= 90 ? "fail" : pct >= 70 ? "warn" : "ok", detail };
}

async function checkDomain(): Promise<Check> {
  try {
    const j = await getJson(`https://rdap.org/domain/${DOMAIN}`);
    const exp = (j?.events ?? []).find((e: any) => e.eventAction === "expiration")?.eventDate as string | undefined;
    if (!exp) return { name: "domain:expiry", level: "warn", detail: "RDAP returned no expiration date." };
    const days = (Date.parse(exp) - Date.now()) / DAY;
    const detail = `${DOMAIN} expires ${exp.slice(0, 10)} (${Math.floor(days)} days).`;
    return { name: "domain:expiry", level: days < 14 ? "fail" : days < 45 ? "warn" : "ok", detail: days < 45 ? `${detail} Renew it or confirm auto-renew.` : detail };
  } catch (e) {
    return { name: "domain:expiry", level: "warn", detail: `Could not read RDAP: ${(e as Error).message}` };
  }
}

// Prepaid upstream credit. These run out silently: paid calls keep settling
// USDC while the upstream returns errors. Unknown response shape -> warn.
async function checkOpenRouter(): Promise<Check> {
  const name = "credit:openrouter";
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { name, level: "fail", detail: "OPENROUTER_API_KEY not set — /api/llm and /api/extract cannot answer." };
  try {
    const j = await getJson("https://openrouter.ai/api/v1/credits", { headers: { authorization: `Bearer ${key}` } });
    const total = Number(j?.data?.total_credits);
    const used = Number(j?.data?.total_usage);
    if (!Number.isFinite(total) || !Number.isFinite(used)) return { name, level: "warn", detail: `Unexpected /credits response: ${JSON.stringify(j).slice(0, 200)}` };
    const left = total - used;
    const detail = `OpenRouter balance $${left.toFixed(2)} (llm + extract).`;
    return left < 0.25
      ? { name, level: "fail", detail: `${detail} Top up now — calls are failing or about to.` }
      : left < 2
        ? { name, level: "warn", detail: `${detail} Top up soon.` }
        : { name, level: "ok", detail };
  } catch (e) {
    return { name, level: "warn", detail: `Could not read OpenRouter credits: ${(e as Error).message}` };
  }
}

async function checkSerper(): Promise<Check> {
  const name = "credit:serper";
  const key = process.env.SERPER_API_KEY;
  if (!key) return { name, level: "warn", detail: "SERPER_API_KEY not set — /api/search falls back to non-Google providers." };
  try {
    const j = await getJson("https://google.serper.dev/account", { headers: { "X-API-KEY": key } });
    const bal = Number(j?.balance);
    if (!Number.isFinite(bal)) return { name, level: "warn", detail: `Unexpected Serper /account response: ${JSON.stringify(j).slice(0, 200)}` };
    const detail = `Serper balance ${bal} searches (/api/search + the Apify search actor, if it uses this key).`;
    return bal < 50
      ? { name, level: "fail", detail: `${detail} Top up now.` }
      : bal < 500
        ? { name, level: "warn", detail: `${detail} Top up soon.` }
        : { name, level: "ok", detail };
  } catch (e) {
    return { name, level: "warn", detail: `Could not read Serper balance: ${(e as Error).message}` };
  }
}

// healthchecks.io is the only alert channel; ERROR_WEBHOOK_URL is deliberately unused.
function checkAlerting(): Check[] {
  return [
    deadMansSwitchArmed()
      ? { name: "alerting:dead-mans-switch", level: "ok", detail: "HEALTHCHECK_PING_URL set." }
      : { name: "alerting:dead-mans-switch", level: "warn", detail: "HEALTHCHECK_PING_URL not set — nothing notices if the crons stop entirely." },
  ];
}

// ── runner ─────────────────────────────────────────────────────────────────

async function guarded(name: string, fn: () => Promise<Check | Check[]>): Promise<Check[]> {
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out after 40s")), 40_000)),
    ]);
    return Array.isArray(r) ? r : [r];
  } catch (e) {
    return [{ name, level: "fail", detail: `check crashed: ${(e as Error)?.message ?? e}` }];
  }
}

export async function runWatchdog(): Promise<{ level: Level; checks: Check[] }> {
  const groups = await Promise.all([
    guarded("cron", checkHeartbeats),
    guarded("ofac", checkOfac),
    guarded("lists", checkScamLists),
    guarded("shield:retention", checkShieldRetention),
    guarded("pay:x402-challenge", checkX402Challenge),
    guarded("pay:cdp-facilitator", checkCdpFacilitator),
    guarded("pay:stripe", checkStripe),
    guarded("apify", checkApify),
    guarded("xrpl:nodes", checkXrpl),
    guarded("neon:size", checkNeonSize),
    guarded("domain:expiry", checkDomain),
    guarded("credit:openrouter", checkOpenRouter),
    guarded("credit:serper", checkSerper),
    guarded("x402v2:rails", checkMultiRail),
    Promise.resolve([...checkAlerting(), checkDbConnection()]),
  ]);
  const checks = groups.flat();
  const level: Level = checks.some((c) => c.level === "fail") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  return { level, checks };
}
