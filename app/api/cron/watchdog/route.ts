// app/api/cron/watchdog/route.ts — daily health sweep (lib/watchdog.ts). Wired
// in vercel.json two hours after refresh-lists, so it grades that run.
//
// Alerting: healthchecks.io is the ONLY channel (no webhook).
//   • any "fail" check -> HEALTHCHECK_PING_URL/fail, with a plain-text list of
//     the red (and warning) checks as the body; healthchecks.io emails it.
//   • otherwise -> a success ping. Warnings ride along in the body + logs only.
//   • This route is the ONLY success pinger, so the check also goes red if the
//     watchdog stops running — and the watchdog is what notices refresh-lists
//     stopping (which additionally pings /fail itself when it fails).
//
// Auth: same CRON_SECRET bearer as the other crons. GET ?dry=1 (still
// authenticated) runs every check but sends no alert and no ping.
import { NextRequest, NextResponse } from "next/server";
import { runWatchdog } from "@/lib/watchdog";
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
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const started = Date.now();
  const { level, checks } = await runWatchdog();
  const problems = checks.filter((c) => c.level !== "ok");
  const body = { ran_at: new Date().toISOString(), duration_ms: Date.now() - started, level, dry, checks };

  if (!dry) {
    // Full check list, so the last result is readable straight from the DB.
    await recordRun("watchdog", level !== "fail", { level, checks });
    // healthchecks.io is the alert channel: any FAIL -> /fail (it emails you,
    // with this body in the message); otherwise a success ping. Warnings stay
    // in the body and the logs only.
    const fails = problems.filter((c) => c.level === "fail");
    const warns = problems.filter((c) => c.level === "warn");
    const summary = [
      fails.length ? `uxus.finance watchdog: ${fails.length} RED check(s)` : `uxus.finance watchdog: no RED checks (${warns.length} warning(s))`,
      ...fails.map((c) => `FAIL ${c.name}: ${c.detail}`),
      ...warns.map((c) => `warn ${c.name}: ${c.detail}`),
      `ran_at ${body.ran_at}; full result in the cron_runs table (job = 'watchdog').`,
    ].join("\n");
    await pingHealthcheck(fails.length ? "/fail" : "", summary);
  }

  console.log(`[cron/watchdog] ${level}`, JSON.stringify(body));
  return NextResponse.json(body, { status: level === "fail" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
