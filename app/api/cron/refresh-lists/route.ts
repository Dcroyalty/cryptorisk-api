// app/api/cron/refresh-lists/route.ts — daily data job. Wired in vercel.json.
//
// 1) Refresh the sanctions + scam lists in bad_addresses (lib/refresh-lists.ts).
//    The OFAC step is a guarded full sync: if the upstream returns fewer than
//    MIN_OFAC addresses it aborts and the table is left untouched.
// 2) Shield housekeeping (Shield.sweep): prune expired nonces/sessions and
//    shield_events older than 90 days — what makes the "90-day retention" claim
//    a guarantee. Folded in here (it used to be /api/cron/sweep, which still
//    exists for manual runs) so vercel.json has a cron slot for the watchdog.
//
// Each step records a heartbeat in cron_runs; /api/cron/watchdog alerts if
// either goes stale. A failure here pings HEALTHCHECK_PING_URL/fail at once
// (healthchecks.io emails the step-by-step body), and the route returns 500 so
// Vercel marks the run failed.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Required —
// this route mutates production data and must not be publicly triggerable.
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { refreshBadAddresses } from "@/lib/refresh-lists";
import * as Shield from "@/lib/shield";
import { recordRun } from "@/lib/cron-runs";
import { pingHealthcheck } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "not_configured", detail: "CRON_SECRET is not set on this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const started = Date.now();

  let report: Awaited<ReturnType<typeof refreshBadAddresses>>;
  try {
    report = await refreshBadAddresses(sql);
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    report = { ok: false, ofac: { error: err }, scamsniffer: { error: err }, mew: { error: err } };
  }
  await recordRun("refresh-lists", report.ok, report);

  let sweep: { ok: boolean; pruned?: unknown; error?: string };
  try {
    sweep = { ok: true, pruned: await Shield.sweep() };
  } catch (e) {
    sweep = { ok: false, error: String((e as Error)?.message ?? e) };
  }
  await recordRun("shield-sweep", sweep.ok, sweep);

  const ok = report.ok && sweep.ok;
  const body = {
    refreshed_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    ...report,
    lists_ok: report.ok,
    ok, // overall: lists AND sweep
    shield_sweep: { retention_days: Shield.EVENT_RETENTION_DAYS, ...sweep },
  };

  if (!ok) {
    console.error("[cron/refresh-lists] FAILED", JSON.stringify(body));
    const step = (name: string, r: unknown) =>
      r && typeof r === "object" && "error" in r ? `FAIL ${name}: ${(r as { error: string }).error}` : `ok   ${name}`;
    await pingHealthcheck(
      "/fail",
      [
        "uxus.finance daily refresh FAILED",
        step("ofac", report.ofac),
        step("scamsniffer", report.scamsniffer),
        step("mew", report.mew),
        sweep.ok ? "ok   shield-sweep" : `FAIL shield-sweep: ${sweep.error}`,
        `ran_at ${body.refreshed_at}`,
      ].join("\n"),
    );
  } else {
    console.log("[cron/refresh-lists] ok", JSON.stringify(body));
  }

  // 500 on any failure so Vercel marks the cron run failed.
  return NextResponse.json(body, { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
