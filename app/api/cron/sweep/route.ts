// app/api/cron/sweep/route.ts — daily Shield housekeeping. Wired in vercel.json.
//
// Prunes expired nonces + sessions and shield_events older than 90 days. This is
// what makes the "90-day retention" claim a guarantee rather than a side effect
// of someone happening to call GET /api/shield/nonce.
//
// Auth: same CRON_SECRET bearer as /api/cron/refresh-lists.
import { NextRequest, NextResponse } from "next/server";
import * as Shield from "@/lib/shield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  try {
    const pruned = await Shield.sweep();
    console.log("[cron/sweep] ok", JSON.stringify(pruned));
    return NextResponse.json(
      { swept_at: new Date().toISOString(), retention_days: Shield.EVENT_RETENTION_DAYS, pruned },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const detail = String((e as Error)?.message ?? e);
    console.error("[cron/sweep] FAILED", detail);
    return NextResponse.json({ error: "sweep_failed", detail }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = run;
export const POST = run;
