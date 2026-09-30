// app/api/cron/watchdog/route.ts — daily health sweep (lib/watchdog.ts). Wired
// in vercel.json two hours after refresh-lists, so it grades that run.
//
// Alerting:
//   • any "fail" or "warn" -> one consolidated message on ERROR_WEBHOOK_URL
//   • HEALTHCHECK_PING_URL gets a success ping only when nothing failed, and a
//     /fail ping otherwise. This route is the ONLY success pinger, so the
//     external check goes red if the watchdog itself stops running — and the
//     watchdog is what notices refresh-lists stopping.
//   • Mondays with everything green -> a short "I'm alive" info message, so
//     silence in the channel is itself a signal.
//
// Auth: same CRON_SECRET bearer as the other crons. GET ?dry=1 (still
// authenticated) runs every check but sends no alert and no ping.
import { NextRequest, NextResponse } from "next/server";
import { runWatchdog } from "@/lib/watchdog";
import { recordRun } from "@/lib/cron-runs";
import { notifyError, notifyInfo, pingHealthcheck } from "@/lib/notify";

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

  let alerted = false;
  if (!dry) {
    // Full check list, so the last result is readable straight from the DB.
    await recordRun("watchdog", level !== "fail", { level, checks });
    if (problems.length) {
      const lines = problems.map((c) => `${c.level === "fail" ? "FAIL" : "warn"} ${c.name}: ${c.detail}`).join("\n");
      alerted = await notifyError("cron/watchdog", `${problems.length} check(s) need attention:\n${lines}`);
    } else if (new Date().getUTCDay() === 1) {
      alerted = await notifyInfo("cron/watchdog", `Weekly check-in: all ${checks.length} health checks green.`);
    }
    await pingHealthcheck(level === "fail" ? "/fail" : "", JSON.stringify(body));
  }

  console.log(`[cron/watchdog] ${level}`, JSON.stringify(body));
  return NextResponse.json({ ...body, alerted }, { status: level === "fail" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
