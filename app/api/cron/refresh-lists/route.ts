// app/api/cron/refresh-lists/route.ts — scheduled refresh of the sanctions +
// scam lists in bad_addresses. Wired in vercel.json ("crons").
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
// when CRON_SECRET is set in the project env. We require it — this route mutates
// production data and must not be publicly triggerable.
//
// The OFAC step is a guarded full sync (see lib/refresh-lists.ts): if the
// upstream returns fewer than MIN_OFAC addresses it aborts and the table is left
// untouched, and this route returns 500 so Vercel flags the failed run.
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { refreshBadAddresses } from "@/lib/refresh-lists";

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
  const report = await refreshBadAddresses(sql);
  const body = { refreshed_at: new Date().toISOString(), duration_ms: Date.now() - started, ...report };

  if (!report.ok) console.error("[cron/refresh-lists] FAILED", JSON.stringify(body));
  else console.log("[cron/refresh-lists] ok", JSON.stringify(body));

  // 500 on any failure so Vercel marks the cron run failed and alerts.
  return NextResponse.json(body, {
    status: report.ok ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = run;
export const POST = run;
